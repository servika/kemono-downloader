/**
 * Mega.nz file and folder downloader
 * Supports anonymous downloads of public files and folders
 */

const { File } = require('megajs');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const { sanitizeFilename } = require('./urlUtils');
const { delay } = require('./delay');

/**
 * Parse mega.nz URL to determine type and extract metadata
 * @param {string} url - Mega.nz URL
 * @returns {Object} - { type: 'file'|'folder', url: string }
 * @throws {Error} - If URL format is invalid
 */
function parseMegaUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid mega.nz URL: URL must be a non-empty string');
  }

  const urlLower = url.toLowerCase();

  // Support multiple URL formats:
  // - https://mega.nz/file/xxx#yyy
  // - https://mega.co.nz/file/xxx#yyy
  // - https://mega.nz/folder/xxx#yyy
  // - https://mega.nz/#!xxx!yyy (legacy file format)
  // - https://mega.nz/#F!xxx!yyy (legacy folder format)

  if (urlLower.includes('/folder/') || urlLower.includes('#f!')) {
    return { type: 'folder', url };
  } else if (urlLower.includes('/file/') || urlLower.includes('#!')) {
    return { type: 'file', url };
  }

  throw new Error('Invalid mega.nz URL format');
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
 * Format seconds to human-readable ETA string
 * @param {number} seconds - Number of seconds
 * @returns {string} - Formatted string (e.g., "2m 30s")
 */
function formatETA(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
}

/**
 * Download single mega.nz file
 * @param {string} url - Mega.nz file URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - { success: boolean, filename: string, size: number, skipped?: boolean }
 */
async function downloadMegaFile(url, destDir, onProgress = () => {}) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const file = File.fromURL(url);

      // Load file attributes (name, size)
      await new Promise((resolve, reject) => {
        file.loadAttributes((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const filename = sanitizeFilename(file.name);
      const filepath = path.join(destDir, filename);

      // Check if file already exists with same size
      if (await fs.pathExists(filepath)) {
        const stats = await fs.stat(filepath);
        if (stats.size > 0 && stats.size === file.size) {
          onProgress(`⏭️  Skipping: ${filename} (already downloaded, ${formatBytes(stats.size)})`);
          return { success: true, filename, size: stats.size, skipped: true };
        }
      }

      await fs.ensureDir(destDir);
      onProgress(`📥 [MEGA] Downloading: ${filename} (${formatBytes(file.size)})`);

      // Download with progress tracking
      let lastProgressTime = Date.now();
      let lastBytesDownloaded = 0;
      const progressInterval = 1000; // Update every 1 second
      const startTime = Date.now();

      const downloadResult = await new Promise((resolve, reject) => {
        file.download((error, data) => {
          if (error) return reject(error);
          resolve(data);
        }, (error, bytesDownloaded) => {
          // Progress callback
          if (error) return; // Ignore progress errors

          const now = Date.now();
          if (now - lastProgressTime >= progressInterval) {
            const percentage = Math.round((bytesDownloaded / file.size) * 100);

            // Calculate download speed
            const timeDiff = (now - lastProgressTime) / 1000; // seconds
            const bytesDiff = bytesDownloaded - lastBytesDownloaded;
            const speedBps = bytesDiff / timeDiff;

            // Calculate ETA
            const remainingBytes = file.size - bytesDownloaded;
            const etaSeconds = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;
            const etaFormatted = etaSeconds > 0 ? formatETA(etaSeconds) : 'calculating...';

            onProgress(`📥 [MEGA] ${filename}: ${percentage}% (${formatBytes(bytesDownloaded)}/${formatBytes(file.size)}) • ${formatBytes(speedBps)}/s • ETA: ${etaFormatted}`);

            lastProgressTime = now;
            lastBytesDownloaded = bytesDownloaded;
          }
        });
      });

      // Write to file
      await fs.writeFile(filepath, Buffer.from(downloadResult));
      onProgress(`✅ [MEGA] Downloaded: ${filename} (${formatBytes(file.size)})`);

      return { success: true, filename, size: file.size, skipped: false };

    } catch (error) {
      lastError = error;

      // Check for specific mega.nz errors that shouldn't be retried
      const errorMsg = error.message || '';

      if (errorMsg.includes('quota') || errorMsg.includes('bandwidth') || errorMsg.includes('limit')) {
        throw new Error(`MEGA quota exceeded: ${errorMsg}`);
      }

      if (errorMsg.includes('EKEY') || errorMsg.includes('invalid') || errorMsg.includes('key')) {
        throw new Error(`Invalid MEGA link or missing decryption key: ${errorMsg}`);
      }

      if (attempt < retryAttempts) {
        onProgress(`🔄 [MEGA] Retry attempt ${attempt + 1}/${retryAttempts} - ${errorMsg}`);
        await delay(retryDelay * attempt); // Exponential backoff
      }
    }
  }

  throw lastError;
}

/**
 * Download mega.nz folder recursively
 * @param {string} url - Mega.nz folder URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - { success: boolean, filesDownloaded: number, filesFailed: number, filesSkipped: number, totalSize: number }
 */
async function downloadMegaFolder(url, destDir, onProgress = () => {}) {
  try {
    const folder = File.fromURL(url);

    // Load folder attributes
    await new Promise((resolve, reject) => {
      folder.loadAttributes((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const folderName = sanitizeFilename(folder.name || 'mega_folder');
    const folderPath = path.join(destDir, folderName);
    await fs.ensureDir(folderPath);

    const childCount = folder.children?.length || 0;
    onProgress(`📁 [MEGA] Downloading folder: ${folderName} (${childCount} items)`);

    let stats = {
      filesDownloaded: 0,
      filesFailed: 0,
      filesSkipped: 0,
      totalSize: 0
    };

    // Recursively download children
    if (folder.children && folder.children.length > 0) {
      for (const child of folder.children) {
        try {
          if (child.directory) {
            // Recursive folder download
            const childUrl = child.link();
            const childStats = await downloadMegaFolder(childUrl, folderPath, onProgress);
            stats.filesDownloaded += childStats.filesDownloaded;
            stats.filesFailed += childStats.filesFailed;
            stats.filesSkipped += childStats.filesSkipped;
            stats.totalSize += childStats.totalSize;
          } else {
            // File download
            const childUrl = child.link();
            const result = await downloadMegaFile(childUrl, folderPath, onProgress);

            if (result.skipped) {
              stats.filesSkipped++;
            } else {
              stats.filesDownloaded++;
            }
            stats.totalSize += result.size;
          }
        } catch (error) {
          const childName = child.name || 'unknown';
          onProgress(`❌ [MEGA] Failed to download: ${childName} - ${error.message}`);
          stats.filesFailed++;
        }
      }
    }

    onProgress(`✅ [MEGA] Folder complete: ${folderName} (${stats.filesDownloaded} downloaded, ${stats.filesSkipped} skipped, ${stats.filesFailed} failed)`);

    return { success: true, ...stats };

  } catch (error) {
    throw new Error(`Failed to download MEGA folder: ${error.message}`);
  }
}

/**
 * Download mega.nz link (auto-detect file vs folder)
 * @param {string} url - Mega.nz URL
 * @param {string} destDir - Destination directory
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Object>} - Download stats
 */
async function downloadMegaLink(url, destDir, onProgress = () => {}) {
  const parsed = parseMegaUrl(url);

  if (parsed.type === 'folder') {
    return await downloadMegaFolder(url, destDir, onProgress);
  } else {
    const result = await downloadMegaFile(url, destDir, onProgress);
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
  parseMegaUrl,
  downloadMegaFile,
  downloadMegaFolder,
  downloadMegaLink,
  formatBytes,
  formatETA
};