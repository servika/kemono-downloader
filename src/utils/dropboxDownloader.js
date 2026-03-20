/**
 * Dropbox file downloader
 * Supports downloading public files and shared folders from Dropbox share links
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
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
 * Use Puppeteer to navigate to a Dropbox shared folder page, click the Download button,
 * and intercept the CDN URL that Dropbox generates for the ZIP download.
 * @param {string} folderUrl - Dropbox shared folder URL
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} - CDN download URL
 */
async function getDropboxFolderDownloadUrl(folderUrl, onProgress = () => {}) {
  let browser = null;
  try {
    onProgress('🌐 [DROPBOX] Launching browser to capture folder download URL...');

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

    let capturedUrl = null;

    // Listen for new tabs that may open with the download URL
    browser.on('targetcreated', async (target) => {
      try {
        const targetUrl = target.url();
        if (isCdnDownloadUrl(targetUrl) && !capturedUrl) {
          capturedUrl = targetUrl;
          return;
        }
        const newPage = await target.page();
        if (!newPage) return;
        await newPage.setRequestInterception(true).catch(() => {});
        newPage.on('request', (req) => {
          const reqUrl = req.url();
          if (isCdnDownloadUrl(reqUrl) && !capturedUrl) {
            capturedUrl = reqUrl;
          }
          req.abort().catch(() => {});
        });
      } catch (_) { /* some targets are service workers or non-page targets */ }
    });

    // Intercept requests on the main page to capture CDN download URL
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const reqUrl = request.url();
      if (isCdnDownloadUrl(reqUrl)) {
        if (!capturedUrl) capturedUrl = reqUrl;
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate with progressive fallback strategy
    onProgress('🌐 [DROPBOX] Loading shared folder page...');
    try {
      await page.goto(folderUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (_) {
      try {
        await page.goto(folderUrl, { waitUntil: 'load', timeout: 20000 });
      } catch (_) {
        await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
    }

    await delay(3000);

    // Find and click the Download button
    const clickResult = await page.evaluate(() => {
      const selectors = [
        '[data-testid="download-button"]',
        'button[aria-label*="Download"]',
        'a[aria-label*="Download"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { el.click(); return `selector: ${sel}`; }
      }
      // Fallback: search by visible text
      const all = [...document.querySelectorAll('button, a[role="button"], a')];
      const btn = all.find(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        return t === 'download' || t === 'download all';
      });
      if (btn) { btn.click(); return `text: ${btn.textContent.trim()}`; }
      return null;
    });

    if (!clickResult) {
      throw new Error('Could not find Download button on Dropbox folder page');
    }

    onProgress(`🖱️ [DROPBOX] ${clickResult}, waiting for CDN URL...`);

    // Poll until the CDN URL is captured
    const POLL_INTERVAL = 500;
    const POLL_TIMEOUT = 20000;
    let elapsed = 0;
    while (!capturedUrl && elapsed < POLL_TIMEOUT) {
      await delay(POLL_INTERVAL);
      elapsed += POLL_INTERVAL;
    }

    if (!capturedUrl) {
      throw new Error('Timed out waiting for Dropbox to prepare download URL');
    }

    onProgress('✅ [DROPBOX] Captured CDN download URL');
    return capturedUrl;
  } finally {
    if (browser) await browser.close();
  }
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

  // For folder URLs, get the actual CDN download URL via Puppeteer before the retry loop
  let folderCdnUrl = null;
  if (isFolder) {
    try {
      folderCdnUrl = await getDropboxFolderDownloadUrl(url, onProgress);
    } catch (err) {
      onProgress(`⚠️ [DROPBOX] Could not auto-download folder: ${err.message}. Download manually from external-links.json.`);
      return { success: false, filename: urlFilename || 'unknown', size: 0, skipped: false, manualRequired: true };
    }
  }

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const { downloadUrl: parsedDownloadUrl, filename: loopFilename } = parseDropboxUrl(url);
      const effectiveUrl = folderCdnUrl || parsedDownloadUrl;

      const response = await axios.get(effectiveUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 30000
      });

      // Extract filename from Content-Disposition header or URL
      let filename = loopFilename;
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }

      if (!filename || filename.includes('?')) {
        filename = `dropbox_file_${Date.now()}`;
      }

      // Detect ZIP content (folder CDN downloads are always ZIPs)
      const contentType = response.headers['content-type'] || '';
      const isZip = isFolder || contentType.includes('application/zip') || contentType.includes('application/x-zip');
      if (isZip && !filename.endsWith('.zip')) {
        filename = `${filename}.zip`;
      }

      filename = sanitizeFilename(filename);
      const filepath = path.join(destDir, filename);
      const fileSize = parseInt(response.headers['content-length'] || '0', 10);

      // Check if file already exists with same size
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

      // Auto-extract ZIP files (folder downloads)
      if (isZip) {
        // Validate ZIP magic bytes (PK\x03\x04) before attempting extraction
        const header = Buffer.alloc(4);
        const fd = await fs.open(filepath, 'r');
        await fs.read(fd, header, 0, 4, 0);
        await fs.close(fd);
        const isValidZip = header[0] === 0x50 && header[1] === 0x4B;

        if (!isValidZip) {
          await fs.remove(filepath);
          onProgress(`⚠️ [DROPBOX] Downloaded file is not a valid ZIP. Download manually from external-links.json.`);
          return { success: false, filename, size: finalSize, skipped: false, manualRequired: true };
        }

        onProgress(`📦 [DROPBOX] Extracting folder contents...`);
        try {
          const zip = new AdmZip(filepath);
          const entries = zip.getEntries().filter(e => !e.isDirectory);
          zip.extractAllTo(destDir, true);
          await fs.remove(filepath);
          onProgress(`✅ [DROPBOX] Extracted ${entries.length} file(s) from folder`);
          return { success: true, filename, size: finalSize, skipped: false, extractedFiles: entries.length };
        } catch (extractError) {
          onProgress(`⚠️ [DROPBOX] ZIP extraction failed: ${extractError.message} (ZIP kept at ${filename})`);
        }
      }

      return { success: true, filename, size: finalSize, skipped: false };

    } catch (error) {
      lastError = error;
      const errorMsg = error.message || '';
      const statusCode = error.response?.status;

      if (statusCode === 404) {
        throw new Error('Dropbox file not found (404) - link may be invalid or expired');
      }
      if (statusCode === 403) {
        throw new Error('Dropbox access denied (403) - file may be private or link expired');
      }
      if (statusCode === 429) {
        throw new Error('Dropbox rate limit exceeded (429) - too many requests');
      }

      if (attempt < retryAttempts) {
        const waitTime = retryDelay * attempt;
        onProgress(`🔄 [DROPBOX] Retry attempt ${attempt + 1}/${retryAttempts} after ${waitTime}ms - ${errorMsg}`);
        await delay(waitTime);
      }
    }
  }

  throw lastError;
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
  getDropboxFolderDownloadUrl,
  downloadDropboxFile,
  downloadDropboxLink,
  formatBytes
};