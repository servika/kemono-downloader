const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { delay } = require('./delay');

/**
 * File and download utilities for images, videos, and archives
 */

async function downloadMedia(mediaUrl, filepath, onProgress) {
  // Use the same download logic for both images and videos
  return downloadImage(mediaUrl, filepath, onProgress);
}

async function downloadMediaWithRetry(mediaUrl, filepath, onProgress, thumbnailUrl = null) {
  // Use the same retry logic for both images and videos
  return downloadImageWithRetry(mediaUrl, filepath, onProgress, thumbnailUrl);
}

async function downloadImageWithRetry(imageUrl, filepath, onProgress, thumbnailUrl = null) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  let lastError = null;

  // Try downloading full resolution first
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      await downloadImage(imageUrl, filepath, onProgress);
      return; // Success, exit retry loop
    } catch (error) {
      lastError = error;

      // If we get 404 and have a thumbnail fallback, try it immediately
      if (error.response?.status === 404 && thumbnailUrl && thumbnailUrl !== imageUrl) {
        if (onProgress) onProgress(`⚠️  Full resolution not found, trying thumbnail...`);
        try {
          await downloadImage(thumbnailUrl, filepath, onProgress);
          if (onProgress) onProgress(`✅ Downloaded thumbnail (full resolution unavailable)`);
          return; // Success with thumbnail
        } catch (thumbnailError) {
          // Thumbnail also failed, continue with original retry logic
          lastError = thumbnailError;
        }
      }

      if (attempt === retryAttempts) {
        // Final attempt failed
        throw lastError;
      } else {
        // Check if we should retry based on error type
        const shouldRetry = error.response?.status >= 500 ||
                           error.response?.status === 429 ||
                           error.response?.status === 403 ||
                           error.code === 'ECONNABORTED' ||
                           error.message.includes('timeout') ||
                           error.message.includes('connection lost') ||
                           error.message.includes('Download interrupted');

        if (shouldRetry) {
          if (onProgress) onProgress(`🔄 Retrying ${path.basename(filepath)} (attempt ${attempt + 1}/${retryAttempts})`);
          await delay(retryDelay);
        } else {
          // Don't retry for other client errors
          throw lastError;
        }
      }
    }
  }
}

async function downloadImage(imageUrl, filepath, onProgress) {
  try {
    if (onProgress) onProgress(`📥 Downloading: ${path.basename(filepath)}`);

    // Determine file type to adjust timeout for potentially large files
    const isVideo = /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp|ogv)$/i.test(filepath);
    const isArchive = /\.(zip|rar|7z|tar|tar\.gz|tar\.bz2|tar\.xz)$/i.test(filepath);
    const baseTimeout = config.get('api.timeout') || 30000; // 30 seconds default
    let timeout = baseTimeout;

    if (isVideo || isArchive) {
      timeout = baseTimeout * 5; // 5x timeout for videos and archives
    }

    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      timeout: timeout,
      headers: {
        'User-Agent': config.get('api.userAgent') || 'Mozilla/5.0 (compatible; kemono-downloader)'
      }
    });

    await fs.ensureDir(path.dirname(filepath));
    const writer = fs.createWriteStream(filepath);

    // Get file size from headers for progress tracking
    const totalSize = parseInt(response.headers['content-length']) || 0;
    let downloadedSize = 0;
    let lastProgressTime = 0;
    const progressInterval = 1000; // Update progress every 1 second

    return new Promise((resolve, reject) => {
      let isResolved = false;
      let streamTimeout;
      let lastDataTime = Date.now();

      const cleanup = (immediate = false) => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }

        // For videos, wait a bit before destroying streams to ensure write completion
        const cleanupDelay = immediate || !isVideo ? 0 : 100;

        setTimeout(() => {
          // Properly unpipe and destroy streams
          if (response.data && !response.data.destroyed) {
            response.data.unpipe(writer);
            response.data.destroy();
          }

          if (writer && !writer.destroyed) {
            writer.destroy();
          }
        }, cleanupDelay);
      };

      const resolveOnce = (result) => {
        if (!isResolved) {
          isResolved = true;
          if (streamTimeout) {
            clearTimeout(streamTimeout);
            streamTimeout = null;
          }
          resolve(result);
        }
      };

      const rejectOnce = (error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup(true); // Immediate cleanup on error
          reject(error);
        }
      };

      const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
      };

      const showProgress = () => {
        if (onProgress && totalSize > 0) {
          const percentage = Math.round((downloadedSize / totalSize) * 100);
          const downloadedFormatted = formatBytes(downloadedSize);
          const totalFormatted = formatBytes(totalSize);
          const filename = path.basename(filepath);

          // Show progress for all files with known size
          const isVideoFile = /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i.test(filename);
          const isArchiveFile = /\.(zip|rar|7z|tar)$/i.test(filename);

          onProgress(`📥 ${filename}: ${percentage}% (${downloadedFormatted}/${totalFormatted})`);
        }
      };

      // Set up adaptive timeout that resets on data activity
      const resetTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
        }
        streamTimeout = setTimeout(() => {
          const timeSinceLastData = Date.now() - lastDataTime;
          if (timeSinceLastData > timeout / 2) {
            rejectOnce(new Error(`Download stalled - no data for ${timeSinceLastData}ms`));
          } else {
            resetTimeout(); // Keep waiting if we're still receiving data
          }
        }, timeout);
      };

      resetTimeout();

      // Track download progress
      response.data.on('data', (chunk) => {
        downloadedSize += chunk.length;
        lastDataTime = Date.now(); // Update last data time for timeout management

        const now = Date.now();
        if (now - lastProgressTime >= progressInterval) {
          showProgress();
          lastProgressTime = now;
        }
      });

      // Handle writer events first, before piping
      writer.on('finish', () => {
        if (onProgress) onProgress(`✅ Downloaded: ${path.basename(filepath)} (${formatBytes(downloadedSize)})`);
        // For videos, add a small delay to ensure file is fully written
        if (isVideo) {
          setTimeout(() => resolveOnce(), 50);
        } else {
          resolveOnce();
        }
      });

      writer.on('error', (error) => {
        if (onProgress) onProgress(`❌ Failed to save: ${path.basename(filepath)} - ${error.message}`);
        rejectOnce(error);
      });

      // Handle writer close event to ensure proper cleanup
      writer.on('close', () => {
        if (!isResolved) {
          // If we reach close without finish, this could be a network interruption
          // Check if we have some data downloaded to determine if this should be retried
          const hasPartialData = downloadedSize > 0;
          const errorMsg = hasPartialData
            ? `Download interrupted after ${formatBytes(downloadedSize)} - connection lost`
            : 'Writer closed unexpectedly - no data received';
          rejectOnce(new Error(errorMsg));
        }
      });

      // Handle response stream errors
      response.data.on('error', (error) => {
        rejectOnce(new Error(`Stream error: ${error.message}`));
      });

      // Only pipe after all event handlers are set up
      response.data.pipe(writer);
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      if (onProgress) onProgress(`⏰ Download timeout: ${path.basename(filepath)}`);
    } else {
      if (onProgress) onProgress(`❌ Failed to download image ${imageUrl}: ${error.message}`);
    }
    throw error;
  }
}

async function savePostMetadata(postDir, postData) {
  const metadataPath = path.join(postDir, 'post-metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(postData, null, 2));
}

async function saveHtmlContent(postDir, html) {
  const htmlPath = path.join(postDir, 'post.html');
  await fs.writeFile(htmlPath, html);
}

async function readProfilesFile(filename) {
  const content = await fs.readFile(filename, 'utf8');
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && line.startsWith('http'));
}

module.exports = {
  downloadImage,
  downloadImageWithRetry,
  downloadMedia,
  downloadMediaWithRetry,
  savePostMetadata,
  saveHtmlContent,
  readProfilesFile
};
