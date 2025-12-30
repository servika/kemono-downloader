/**
 * Google Drive file downloader
 * Supports anonymous downloads of public files
 * Folders require API key and are gracefully skipped
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const { sanitizeFilename } = require('./urlUtils');
const { delay } = require('./delay');

/**
 * Parse Google Drive URL to determine type and extract file/folder ID
 * @param {string} url - Google Drive URL
 * @returns {Object} - { type: 'file'|'folder', id: string, url: string }
 * @throws {Error} - If URL format is invalid
 */
function parseGoogleDriveUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid Google Drive URL: URL must be a non-empty string');
  }

  // File URL patterns
  const filePatterns = [
    /\/file\/d\/([^\/\?]+)/, // https://drive.google.com/file/d/FILE_ID/view
    /[?&]id=([^&]+)/, // https://drive.google.com/open?id=FILE_ID
    /\/document\/d\/([^\/\?]+)/, // https://docs.google.com/document/d/FILE_ID/edit
    /\/spreadsheets\/d\/([^\/\?]+)/, // https://docs.google.com/spreadsheets/d/FILE_ID/edit
    /\/presentation\/d\/([^\/\?]+)/ // https://docs.google.com/presentation/d/FILE_ID/edit
  ];

  for (const pattern of filePatterns) {
    const match = url.match(pattern);
    if (match) {
      return { type: 'file', id: match[1], url };
    }
  }

  // Folder URL patterns
  const folderMatch = url.match(/\/folders\/([^\/\?]+)/);
  if (folderMatch) {
    return { type: 'folder', id: folderMatch[1], url };
  }

  throw new Error('Invalid Google Drive URL format');
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
 * Download single Google Drive file
 * @param {string} fileId - Google Drive file ID
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - { success: boolean, filename: string, size: number, skipped?: boolean }
 */
async function downloadGoogleDriveFile(fileId, destDir, onProgress = () => {}) {
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      // Make initial request to get filename and content
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        validateStatus: (status) => status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Extract filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition'];
      let filename = `google_drive_file_${fileId}`;

      if (contentDisposition) {
        // Match both quoted and unquoted filenames
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=(?:(\\?['"])(.*?)\1|(?:[^\s]+'.*?')?([^;\n]*))/);
        if (filenameMatch) {
          filename = filenameMatch[2] || filenameMatch[3] || filename;
          // Remove quotes if present
          filename = filename.replace(/^["']|["']$/g, '');
        }
      }

      filename = sanitizeFilename(filename);
      const filepath = path.join(destDir, filename);

      // Check if file already exists
      if (await fs.pathExists(filepath)) {
        const stats = await fs.stat(filepath);
        const contentLength = parseInt(response.headers['content-length'] || '0', 10);
        if (stats.size > 0 && contentLength > 0 && stats.size === contentLength) {
          onProgress(`⏭️  Skipping: ${filename} (already downloaded, ${formatBytes(stats.size)})`);
          return { success: true, filename, size: stats.size, skipped: true };
        }
      }

      await fs.ensureDir(destDir);
      onProgress(`📥 [Google Drive] Downloading: ${filename}`);

      // Download file
      const writer = fs.createWriteStream(filepath);

      let downloadedBytes = 0;
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);

      if (contentLength > 0) {
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percentage = Math.round((downloadedBytes / contentLength) * 100);
          if (percentage % 25 === 0) { // Log at 25%, 50%, 75%, 100%
            onProgress(`📥 [Google Drive] ${filename}: ${percentage}% (${formatBytes(downloadedBytes)}/${formatBytes(contentLength)})`);
          }
        });
      }

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      const finalStats = await fs.stat(filepath);
      onProgress(`✅ [Google Drive] Downloaded: ${filename} (${formatBytes(finalStats.size)})`);

      return { success: true, filename, size: finalStats.size, skipped: false };

    } catch (error) {
      lastError = error;

      const errorMsg = error.message || '';

      // Check for specific errors that shouldn't be retried
      if (error.response) {
        if (error.response.status === 403 || error.response.status === 404) {
          throw new Error(`Google Drive file not accessible (${error.response.status}): File may be private or deleted`);
        }
      }

      if (attempt < retryAttempts) {
        onProgress(`🔄 [Google Drive] Retry attempt ${attempt + 1}/${retryAttempts} - ${errorMsg}`);
        await delay(retryDelay * attempt); // Exponential backoff
      }
    }
  }

  throw lastError;
}

/**
 * Handle Google Drive folder (graceful skip)
 * @param {string} folderId - Google Drive folder ID
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - Stats object indicating folder was skipped
 */
async function downloadGoogleDriveFolder(folderId, destDir, onProgress = () => {}) {
  // Google Drive requires API key to list folder contents
  // For anonymous downloads, we cannot access folder contents
  onProgress(`⚠️  [Google Drive] Cannot download folders without API key`);
  onProgress(`   Folder link saved in external-links.json for manual download`);

  return {
    success: false,
    filesDownloaded: 0,
    filesFailed: 0,
    filesSkipped: 0,
    totalSize: 0,
    isFolderSkipped: true
  };
}

/**
 * Download Google Drive link (auto-detect file vs folder)
 * @param {string} url - Google Drive URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - Download stats
 */
async function downloadGoogleDriveLink(url, destDir, onProgress = () => {}) {
  const parsed = parseGoogleDriveUrl(url);

  if (parsed.type === 'folder') {
    return await downloadGoogleDriveFolder(parsed.id, destDir, onProgress);
  } else {
    const result = await downloadGoogleDriveFile(parsed.id, destDir, onProgress);
    return {
      success: result.success,
      filesDownloaded: result.skipped ? 0 : 1,
      filesFailed: result.success ? 0 : 1,
      filesSkipped: result.skipped ? 1 : 0,
      totalSize: result.size
    };
  }
}

module.exports = {
  parseGoogleDriveUrl,
  downloadGoogleDriveFile,
  downloadGoogleDriveFolder,
  downloadGoogleDriveLink,
  formatBytes
};