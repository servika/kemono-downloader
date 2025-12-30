/**
 * Dropbox file downloader
 * Supports downloading public files from Dropbox share links
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const { sanitizeFilename } = require('./urlUtils');
const { delay } = require('./delay');

/**
 * Parse Dropbox URL to extract file ID and convert to direct download URL
 * @param {string} url - Dropbox URL
 * @returns {Object} - { fileId: string, downloadUrl: string, filename: string|null }
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
  // - https://www.dropbox.com/sh/FOLDERID/... (folders not supported)

  const urlLower = url.toLowerCase();

  // Check if it's a folder URL (not supported)
  if (urlLower.includes('/sh/')) {
    throw new Error('Dropbox folder downloads are not supported (only individual files)');
  }

  // Extract filename from URL path
  let filename = null;
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  if (pathParts.length >= 4) {
    filename = pathParts[pathParts.length - 1];
  }

  // Convert to direct download URL
  let downloadUrl = url;

  // If it's a regular dropbox.com URL, convert dl=0 to dl=1
  if (urlLower.includes('dropbox.com/s/') || urlLower.includes('dropbox.com/scl/fi/')) {
    // Replace dl=0 with dl=1, or add dl=1 if not present
    if (downloadUrl.includes('dl=0')) {
      downloadUrl = downloadUrl.replace('dl=0', 'dl=1');
    } else if (!downloadUrl.includes('dl=1')) {
      const separator = downloadUrl.includes('?') ? '&' : '?';
      downloadUrl = `${downloadUrl}${separator}dl=1`;
    }
  }

  // Extract file ID for tracking
  const fileIdMatch = url.match(/\/s\/([a-zA-Z0-9]+)/);
  const fileId = fileIdMatch ? fileIdMatch[1] : 'unknown';

  return {
    fileId,
    downloadUrl,
    filename
  };
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} - Formatted string (e.g., "145.3 MB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Download single Dropbox file
 * @param {string} url - Dropbox file URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - { success: boolean, filename: string, size: number, skipped?: boolean }
 */
async function downloadDropboxFile(url, destDir, onProgress = () => {}) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const { downloadUrl, filename: urlFilename } = parseDropboxUrl(url);

      // Make request to get file metadata and start download
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 30000
      });

      // Extract filename from Content-Disposition header or URL
      let filename = urlFilename;
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

      filename = sanitizeFilename(filename);
      const filepath = path.join(destDir, filename);

      // Get file size from headers
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

      // Download file with progress tracking
      const writer = fs.createWriteStream(filepath);
      let downloadedBytes = 0;
      let lastProgressUpdate = Date.now();
      const progressInterval = 1000; // Update every 1 second

      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();

        if (fileSize > 0 && now - lastProgressUpdate >= progressInterval) {
          const percentage = Math.round((downloadedBytes / fileSize) * 100);
          onProgress(`📥 [DROPBOX] ${filename}: ${percentage}% (${formatBytes(downloadedBytes)}/${formatBytes(fileSize)})`);
          lastProgressUpdate = now;
        }
      });

      // Pipe the response to file
      response.data.pipe(writer);

      // Wait for download to complete
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

      // Check for specific errors that shouldn't be retried
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
        const waitTime = retryDelay * attempt; // Exponential backoff
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
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - Download stats
 */
async function downloadDropboxLink(url, destDir, onProgress = () => {}) {
  try {
    const result = await downloadDropboxFile(url, destDir, onProgress);
    return {
      success: result.success,
      filesDownloaded: result.skipped ? 0 : 1,
      filesFailed: result.success ? 0 : 1,
      filesSkipped: result.skipped ? 1 : 0,
      totalSize: result.size
    };
  } catch (error) {
    onProgress(`❌ [DROPBOX] Failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  parseDropboxUrl,
  downloadDropboxFile,
  downloadDropboxLink,
  formatBytes
};