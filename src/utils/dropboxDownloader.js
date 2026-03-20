/**
 * Dropbox file downloader
 * Supports downloading public files and shared folders from Dropbox share links
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');
const { sanitizeFilename } = require('./urlUtils');
const { delay } = require('./delay');

puppeteer.use(StealthPlugin());

/**
 * Parse Dropbox URL to extract file ID and convert to direct download URL
 * @param {string} url - Dropbox URL
 * @returns {Object} - { fileId, downloadUrl, filename, isFolder }
 * @throws {Error} - If URL format is invalid
 */
function parseDropboxUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid Dropbox URL: URL must be a non-empty string');
  }

  // Supported URL formats:
  // - https://www.dropbox.com/s/FILEID/filename?dl=0
  // - https://www.dropbox.com/s/FILEID/filename?dl=1
  // - https://www.dropbox.com/scl/fi/FILEID/filename?rlkey=KEY&dl=0
  // - https://dl.dropboxusercontent.com/s/FILEID/filename
  // - https://www.dropbox.com/sh/FOLDERID/... (old folder format, downloads as ZIP)
  // - https://www.dropbox.com/scl/fo/FOLDERID/name?rlkey=KEY (new folder format)

  const urlLower = url.toLowerCase();

  // Detect folder URLs (both old /sh/ and new /scl/fo/ formats)
  const isFolder = urlLower.includes('/sh/') || urlLower.includes('/scl/fo/');

  // Extract filename from URL path
  let filename = null;
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  if (pathParts.length >= 4) {
    filename = pathParts[pathParts.length - 1];
  }

  // Convert to direct download URL (dl=1 triggers download for file links)
  let downloadUrl = url;
  if (
    urlLower.includes('dropbox.com/s/') ||
    urlLower.includes('dropbox.com/scl/fi/') ||
    urlLower.includes('dropbox.com/scl/fo/') ||
    urlLower.includes('dropbox.com/sh/')
  ) {
    if (downloadUrl.includes('dl=0')) {
      downloadUrl = downloadUrl.replace('dl=0', 'dl=1');
    } else if (!downloadUrl.includes('dl=1')) {
      const separator = downloadUrl.includes('?') ? '&' : '?';
      downloadUrl = `${downloadUrl}${separator}dl=1`;
    }
  }

  // Extract file ID for tracking
  const fileIdMatch = url.match(/\/(?:s|sh|fo|fi)\/([a-zA-Z0-9]+)/);
  const fileId = fileIdMatch ? fileIdMatch[1] : 'unknown';

  return { fileId, downloadUrl, filename, isFolder };
}

/**
 * Check if a URL is a Dropbox CDN download URL
 * @param {string} url
 * @returns {boolean}
 */
function isCdnDownloadUrl(url) {
  return url.includes('dl.dropboxusercontent.com') || url.includes('dropbox.com/zip/download');
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Download a ZIP from a direct URL and extract its contents to destDir.
 * @param {string} zipUrl - Direct ZIP download URL (e.g. captured via CDP)
 * @param {string} destDir - Destination directory
 * @param {string} folderName - Display name for progress messages
 * @param {Function} onProgress - Progress callback
 * @param {string|null} cookieHeader - Optional session cookie header
 * @returns {Promise<Object>} - { success, filename, size, skipped, extractedFiles }
 */
async function downloadAndExtractZip(zipUrl, destDir, folderName, onProgress, cookieHeader) {
  const tmpPath = path.join(os.tmpdir(), `dropbox_folder_${Date.now()}.zip`);
  try {
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};
    const response = await axios.get(zipUrl, {
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 120000,
      headers
    });

    const contentType = response.headers['content-type'] || '';
    if (contentType.startsWith('text/html')) {
      response.data.destroy();
      throw new Error('ZIP URL returned an HTML page — the download link may have expired');
    }

    const fileSize = parseInt(response.headers['content-length'] || '0', 10);
    onProgress(`📥 [DROPBOX] Downloading folder ZIP${fileSize > 0 ? ` (${formatBytes(fileSize)})` : ''}...`);

    const writer = fs.createWriteStream(tmpPath);
    let downloadedBytes = 0;
    let lastProgressUpdate = Date.now();

    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const now = Date.now();
      if (fileSize > 0 && now - lastProgressUpdate >= 1000) {
        const percentage = Math.round((downloadedBytes / fileSize) * 100);
        onProgress(`📥 [DROPBOX] ZIP: ${percentage}% (${formatBytes(downloadedBytes)}/${formatBytes(fileSize)})`);
        lastProgressUpdate = now;
      }
    });

    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    onProgress(`✅ [DROPBOX] ZIP downloaded, extracting...`);

    await fs.ensureDir(destDir);
    const zip = new AdmZip(tmpPath);
    const entries = zip.getEntries();
    const fileEntries = entries.filter(e => !e.isDirectory);

    let extractedCount = 0;
    let totalSize = 0;
    for (const entry of fileEntries) {
      const entryFilename = sanitizeFilename(path.basename(entry.entryName));
      zip.extractEntryTo(entry, destDir, false, true);
      const stats = await fs.stat(path.join(destDir, entryFilename)).catch(() => ({ size: 0 }));
      totalSize += stats.size;
      extractedCount++;
      onProgress(`📂 [DROPBOX] Extracted: ${entryFilename}`);
    }

    onProgress(`✅ [DROPBOX] Extracted ${extractedCount} file(s) from folder ZIP`);
    return { success: true, filename: folderName, size: totalSize, skipped: false, extractedFiles: extractedCount };
  } finally {
    await fs.remove(tmpPath).catch(() => {});
  }
}

/**
 * Use Puppeteer to navigate to a Dropbox shared folder page and intercept the
 * automatic list_shared_link_folder_entries API call that Dropbox makes on page load.
 * Also attempts to capture a folder-level ZIP download URL via CDP.
 * Handles pagination by scrolling to trigger additional API calls.
 * @param {string} folderUrl - Dropbox shared folder URL
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} - { files: Array<{ filename, url, size }>, cookieHeader, zipUrl }
 */
async function getDropboxFolderFiles(folderUrl, onProgress = () => {}) {
  let browser = null;
  try {
    onProgress('🌐 [DROPBOX] Launching browser to list folder contents...');

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const allEntries = [];
    let hasMore = false;
    const responsePromises = [];

    // Set up CDP to intercept the folder-level ZIP download URL
    let capturedZipUrl = null;
    try {
      const client = await page.target().createCDPSession();
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'deny',
        downloadPath: os.tmpdir(),
        eventsEnabled: true
      });
      client.on('Browser.downloadWillBegin', (event) => {
        const { url } = event;
        if (url.includes('dl.dropboxusercontent.com') || url.includes('dropbox.com/zip/')) {
          capturedZipUrl = url;
          onProgress('📦 [DROPBOX] Captured folder download URL');
        }
      });
    } catch (_) { /* CDP not available in this environment */ }

    // Intercept the folder listing API that Dropbox calls automatically on page load
    page.on('response', (resp) => {
      if (!resp.url().includes('list_shared_link_folder_entries')) return;
      const p = resp.json().then(data => {
        const files = (data.entries || []).filter(e => !e.is_dir);
        allEntries.push(...files);
        hasMore = data.has_more_entries || false;
      }).catch(() => {});
      responsePromises.push(p);
    });

    onProgress('🌐 [DROPBOX] Loading folder page...');
    try {
      await page.goto(folderUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (_) {
      try {
        await page.goto(folderUrl, { waitUntil: 'load', timeout: 20000 });
      } catch (_) {
        await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
    }

    await delay(2000);
    await Promise.all(responsePromises);

    // Handle pagination: scroll to trigger Dropbox's infinite scroll / load more
    let prevCount = 0;
    while (hasMore && allEntries.length > prevCount) {
      prevCount = allEntries.length;
      hasMore = false; // reset; will be set again by response handler if more pages exist
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(3000);
      await Promise.all(responsePromises);
    }

    // Try clicking the folder-level Download button to capture a ZIP URL via CDP
    if (!capturedZipUrl && allEntries.length > 0) {
      try {
        const clicked = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('button, [role="button"]'));
          const btn = els.find(el => {
            const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
            return t === 'download' || t === 'download all';
          });
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (clicked) {
          onProgress('🖱️  [DROPBOX] Clicked Download button, waiting for ZIP URL...');
          await delay(5000);
        }
      } catch (_) { /* Download button click failed, continuing with per-file approach */ }
    }

    if (allEntries.length === 0) {
      throw new Error('No files found in folder — Dropbox may require a login or the folder is empty');
    }

    onProgress(`✅ [DROPBOX] Found ${allEntries.length} file(s) in folder`);

    // Capture session cookies — required for downloading files via axios
    // (without them Dropbox returns an HTML page instead of the actual file)
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Convert each entry's href to a direct download URL
    const files = allEntries.map(entry => ({
      filename: entry.filename,
      url: entry.href.includes('dl=0') ? entry.href.replace('dl=0', 'dl=1') : `${entry.href}&dl=1`,
      size: entry.bytes || 0
    }));

    return { files, cookieHeader, zipUrl: capturedZipUrl };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Download a single file from a direct URL to destDir with retry logic.
 * @param {string} downloadUrl - Direct download URL
 * @param {string} destDir - Destination directory
 * @param {string|null} hintFilename - Filename hint from URL or folder listing
 * @param {Function} onProgress - Progress callback
 * @param {number} retryAttempts - Max retry count
 * @param {number} retryDelay - Base delay between retries in ms
 * @returns {Promise<Object>} - { success, filename, size, skipped }
 */
async function downloadSingleFile(downloadUrl, destDir, hintFilename, onProgress, retryAttempts, retryDelay, cookieHeader = null) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const headers = cookieHeader ? { Cookie: cookieHeader } : {};
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 30000,
        headers
      });

      // Detect HTML responses — Dropbox returns HTML for invalid/expired download links
      const contentType = response.headers['content-type'] || '';
      if (contentType.startsWith('text/html')) {
        response.data.destroy();
        throw new Error('Dropbox returned an HTML page instead of file content — the download link may be invalid or require authentication');
      }

      // Resolve filename from Content-Disposition, hint, or fallback
      let filename = hintFilename;
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) filename = match[1].replace(/['"]/g, '');
      }
      if (!filename || filename.includes('?')) filename = `dropbox_file_${Date.now()}`;
      filename = sanitizeFilename(filename);

      const filepath = path.join(destDir, filename);
      const fileSize = parseInt(response.headers['content-length'] || '0', 10);

      if (await fs.pathExists(filepath)) {
        const stats = await fs.stat(filepath);
        if (stats.size > 0 && fileSize > 0 && stats.size === fileSize) {
          onProgress(`⏭️  Skipping: ${filename} (already downloaded, ${formatBytes(stats.size)})`);
          return { success: true, filename, size: stats.size, skipped: true };
        }
      }

      await fs.ensureDir(destDir);
      onProgress(`📥 [DROPBOX] Downloading: ${filename}${fileSize > 0 ? ` (${formatBytes(fileSize)})` : ''}`);

      const writer = fs.createWriteStream(filepath);
      let downloadedBytes = 0;
      let lastProgressUpdate = Date.now();

      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (fileSize > 0 && now - lastProgressUpdate >= 1000) {
          const percentage = Math.round((downloadedBytes / fileSize) * 100);
          onProgress(`📥 [DROPBOX] ${filename}: ${percentage}% (${formatBytes(downloadedBytes)}/${formatBytes(fileSize)})`);
          lastProgressUpdate = now;
        }
      });

      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      const finalSize = (await fs.stat(filepath)).size;
      onProgress(`✅ [DROPBOX] Downloaded: ${filename} (${formatBytes(finalSize)})`);
      return { success: true, filename, size: finalSize, skipped: false };

    } catch (error) {
      lastError = error;
      const statusCode = error.response?.status;
      if (statusCode === 404) throw new Error(`Dropbox file not found (404) - link may be invalid or expired`);
      if (statusCode === 403) throw new Error(`Dropbox access denied (403) - file may be private or link expired`);
      if (statusCode === 429) throw new Error(`Dropbox rate limit exceeded (429) - too many requests`);

      if (attempt < retryAttempts) {
        const waitTime = retryDelay * attempt;
        onProgress(`🔄 [DROPBOX] Retry ${attempt + 1}/${retryAttempts} after ${waitTime}ms - ${error.message}`);
        await delay(waitTime);
      }
    }
  }
  throw lastError;
}

/**
 * Download single Dropbox file or folder
 * @param {string} url - Dropbox URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>}
 */
async function downloadDropboxFile(url, destDir, onProgress = () => {}) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  let lastError = null;

  const { isFolder, filename: urlFilename } = parseDropboxUrl(url);

  // For folder URLs, list individual files via Puppeteer and download each separately
  if (isFolder) {
    try {
      const { files, cookieHeader, zipUrl } = await getDropboxFolderFiles(url, onProgress);

      // If a folder-level ZIP URL was captured via CDP, download and extract it
      if (zipUrl) {
        onProgress('📦 [DROPBOX] Downloading folder as ZIP...');
        try {
          return await downloadAndExtractZip(zipUrl, destDir, urlFilename || 'folder', onProgress, cookieHeader);
        } catch (zipErr) {
          onProgress(`⚠️ [DROPBOX] ZIP download failed: ${zipErr.message}. Falling back to per-file download...`);
        }
      }

      let totalDownloaded = 0;
      let totalSize = 0;

      for (const file of files) {
        try {
          const result = await downloadSingleFile(file.url, destDir, file.filename, onProgress, retryAttempts, retryDelay, cookieHeader);
          if (!result.skipped) totalDownloaded++;
          totalSize += result.size || 0;
        } catch (err) {
          onProgress(`⚠️ [DROPBOX] Failed to download ${file.filename}: ${err.message}`);
        }
      }

      return { success: true, filename: urlFilename || 'folder', size: totalSize, skipped: false, extractedFiles: totalDownloaded };
    } catch (err) {
      onProgress(`⚠️ [DROPBOX] Could not list folder contents: ${err.message}. Download manually from external-links.json.`);
      return { success: false, filename: urlFilename || 'unknown', size: 0, skipped: false, manualRequired: true };
    }
  }

  // For single file URLs, download directly
  const { downloadUrl } = parseDropboxUrl(url);
  return await downloadSingleFile(downloadUrl, destDir, urlFilename, onProgress, retryAttempts, retryDelay);
}

/**
 * Download Dropbox link (wrapper for consistency with other downloaders)
 * @param {string} url - Dropbox URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} - Download stats
 */
async function downloadDropboxLink(url, destDir, onProgress = () => {}) {
  try {
    const result = await downloadDropboxFile(url, destDir, onProgress);
    const filesDownloaded = result.skipped ? 0 : (result.extractedFiles != null ? result.extractedFiles : (result.success ? 1 : 0));
    return {
      success: result.success,
      filesDownloaded,
      filesFailed: (result.success || result.manualRequired) ? 0 : 1,
      filesSkipped: result.skipped ? 1 : 0,
      manualRequired: result.manualRequired || false,
      totalSize: result.size
    };
  } catch (error) {
    onProgress(`❌ [DROPBOX] Failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  parseDropboxUrl,
  isCdnDownloadUrl,
  getDropboxFolderFiles,
  downloadSingleFile,
  downloadAndExtractZip,
  downloadDropboxFile,
  downloadDropboxLink,
  formatBytes
};