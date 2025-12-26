const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { delay } = require('./delay');

/**
 * File and download utilities for images and videos
 */

async function downloadMedia(mediaUrl, filepath, onProgress) {
  // Use the same download logic for both images and videos
  return downloadImage(mediaUrl, filepath, onProgress);
}

async function downloadMediaWithRetry(mediaUrl, filepath, onProgress) {
  // Use the same retry logic for both images and videos
  return downloadImageWithRetry(mediaUrl, filepath, onProgress);
}

async function downloadImageWithRetry(imageUrl, filepath, onProgress) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      await downloadImage(imageUrl, filepath, onProgress);
      return; // Success, exit retry loop
    } catch (error) {
      if (attempt === retryAttempts) {
        // Final attempt failed
        throw error;
      } else {
        // Check if we should retry based on error type
        const shouldRetry = error.response?.status >= 500 || 
                           error.response?.status === 429 || 
                           error.response?.status === 403 ||
                           error.code === 'ECONNABORTED' ||
                           error.message.includes('timeout');
        
        if (shouldRetry) {
          if (onProgress) onProgress(`🔄 Retrying ${path.basename(filepath)} (attempt ${attempt + 1}/${retryAttempts})`);
          await delay(retryDelay);
        } else {
          // Don't retry for client errors like 404
          throw error;
        }
      }
    }
  }
}

async function downloadImage(imageUrl, filepath, onProgress) {
  try {
    if (onProgress) onProgress(`📥 Downloading: ${path.basename(filepath)}`);
    
    const timeout = config.get('api.timeout') || 30000; // 30 seconds default
    
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
      
      const cleanup = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
        
        // Properly unpipe and destroy streams
        if (response.data && !response.data.destroyed) {
          response.data.unpipe(writer);
          response.data.destroy();
        }
        
        if (writer && !writer.destroyed) {
          writer.destroy();
        }
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
          cleanup();
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
          
          // Show progress for files larger than 1MB or videos
          const isLargeFile = totalSize > 1024 * 1024; // 1MB
          const isVideoFile = /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i.test(filename);
          
          if (isLargeFile || isVideoFile) {
            onProgress(`📥 ${filename}: ${percentage}% (${downloadedFormatted}/${totalFormatted})`);
          }
        }
      };
      
      // Set up timeout for the stream writing process
      streamTimeout = setTimeout(() => {
        rejectOnce(new Error(`Download timeout after ${timeout}ms`));
      }, timeout);
      
      // Track download progress
      response.data.on('data', (chunk) => {
        downloadedSize += chunk.length;
        
        const now = Date.now();
        if (now - lastProgressTime >= progressInterval) {
          showProgress();
          lastProgressTime = now;
        }
      });
      
      // Handle writer events first, before piping
      writer.on('finish', () => {
        if (onProgress) onProgress(`✅ Downloaded: ${path.basename(filepath)} (${formatBytes(downloadedSize)})`);
        resolveOnce();
      });
      
      writer.on('error', (error) => {
        if (onProgress) onProgress(`❌ Failed to save: ${path.basename(filepath)} - ${error.message}`);
        rejectOnce(error);
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