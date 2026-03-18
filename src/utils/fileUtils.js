const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');
const { delay } = require('./delay');
const { getImageName } = require('./urlUtils');

/**
 * File and download utilities for images, videos, and archives
 */

// Maps Content-Type MIME types to file extensions for .bin detection
const CONTENT_TYPE_EXT_MAP = {
  'image/vnd.adobe.photoshop': '.psd',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/flac': '.flac',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/pdf': '.pdf',
};

/**
 * Validates the PSD/PSB file header structure.
 * Header layout (26 bytes): magic(4) + version(2) + reserved(6) + channels(2) + height(4) + width(4) + bitDepth(2) + colorMode(2)
 * @param {Buffer} head - First bytes of the file (need ≥26 bytes)
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePsdHeader(head) {
  if (!head || head.length < 26) {
    return { valid: false, reason: 'PSD file too small to contain a valid header (need ≥26 bytes)' };
  }
  // Magic: "8BPS"
  if (head[0] !== 0x38 || head[1] !== 0x42 || head[2] !== 0x50 || head[3] !== 0x53) {
    return { valid: false, reason: 'PSD missing "8BPS" magic bytes — not a valid PSD/PSB file' };
  }
  // Version: 1 = PSD, 2 = PSB (large document format)
  const version = head.readUInt16BE(4);
  if (version !== 1 && version !== 2) {
    return { valid: false, reason: `PSD invalid version ${version} — expected 1 (PSD) or 2 (PSB)` };
  }
  // Reserved bytes 6–11 must be zero
  for (let i = 6; i <= 11; i++) {
    if (head[i] !== 0) {
      return { valid: false, reason: 'PSD header reserved bytes are non-zero — file is corrupt' };
    }
  }
  // Channels: 1–56
  const channels = head.readUInt16BE(12);
  if (channels < 1 || channels > 56) {
    return { valid: false, reason: `PSD invalid channel count ${channels} — expected 1–56` };
  }
  // Height and width must be positive
  const height = head.readUInt32BE(14);
  const width = head.readUInt32BE(18);
  if (height === 0 || width === 0) {
    return { valid: false, reason: 'PSD has zero width or height — file is corrupt' };
  }
  // Bit depth: 1, 8, 16, or 32
  const bitDepth = head.readUInt16BE(22);
  if (![1, 8, 16, 32].includes(bitDepth)) {
    return { valid: false, reason: `PSD invalid bit depth ${bitDepth} — expected 1, 8, 16, or 32` };
  }
  return { valid: true };
}

/**
 * Detects file type from magic bytes (file signature).
 * Used as a last resort when Content-Type is application/octet-stream.
 * @param {Buffer} buf - First bytes of the file
 * @returns {string|null} Extension including dot, or null if unknown
 */
function detectMagicExtension(buf) {
  if (!buf || buf.length < 4) return null;
  // PSD: "8BPS"
  if (buf[0] === 0x38 && buf[1] === 0x42 && buf[2] === 0x50 && buf[3] === 0x53) return '.psd';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp';
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return '.pdf';
  // ZIP / CLIP Studio Paint / many Office formats
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return '.zip';
  // RAR
  if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return '.rar';
  // 7-Zip
  if (buf[0] === 0x37 && buf[1] === 0x7A && buf[2] === 0xBC && buf[3] === 0xAF) return '.7z';
  // MP4 / MOV: ftyp box at offset 4
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return '.mp4';
  return null;
}

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
      const result = await downloadImage(imageUrl, filepath, onProgress);
      return result; // Success, exit retry loop - result includes actual filepath
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

      const shouldDeleteFile = error.message.includes('Size mismatch') ||
                               error.message.includes('File size mismatch') ||
                               error.message.includes('truncated') ||
                               error.message.includes('connection lost') ||
                               error.message.includes('Download interrupted');

      if (attempt === retryAttempts) {
        // Final attempt failed — clean up any corrupt/partial file before throwing
        if (shouldDeleteFile) {
          try {
            if (await fs.pathExists(filepath)) {
              await fs.remove(filepath);
              if (onProgress) onProgress(`🗑️  Deleted incomplete file: ${path.basename(filepath)}`);
            }
          } catch (deleteError) {
            if (onProgress) onProgress(`⚠️  Failed to delete incomplete file: ${deleteError.message}`);
          }
        }
        throw lastError;
      } else {
        // Check if we should retry based on error type
        const shouldRetry = error.response?.status >= 500 ||
                           error.response?.status === 429 ||
                           error.response?.status === 403 ||
                           error.code === 'ECONNABORTED' ||
                           error.message.includes('timeout') ||
                           shouldDeleteFile;

        if (shouldRetry) {
          // Delete incomplete/corrupt file before retrying
          if (shouldDeleteFile) {
            try {
              if (await fs.pathExists(filepath)) {
                await fs.remove(filepath);
                if (onProgress) onProgress(`🗑️  Deleted incomplete file: ${path.basename(filepath)}`);
              }
            } catch (deleteError) {
              if (onProgress) onProgress(`⚠️  Failed to delete incomplete file: ${deleteError.message}`);
            }
          }

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

    // For .bin files, try to determine the real extension from response headers
    // kemono.cr CDN stores many file types (PSD, CLIP, etc.) with .bin extension
    const state = { filepath };
    if (path.extname(filepath).toLowerCase() === '.bin') {
      // 1. Check Content-Disposition header for the real filename
      const disposition = response.headers['content-disposition'];
      if (disposition) {
        const match = /filename[^;=\n]*=\s*["']?([^"';\n\r]+)["']?/i.exec(disposition);
        if (match) {
          const dispName = match[1].trim().replace(/["']/g, '');
          const dispExt = path.extname(dispName).toLowerCase();
          if (dispExt && dispExt !== '.bin') {
            state.filepath = path.join(path.dirname(filepath), path.basename(filepath, '.bin') + dispExt);
          }
        }
      }
      // 2. Check Content-Type header
      if (state.filepath === filepath) {
        const contentType = (response.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
        const detectedExt = CONTENT_TYPE_EXT_MAP[contentType];
        if (detectedExt) {
          state.filepath = path.join(path.dirname(filepath), path.basename(filepath, '.bin') + detectedExt);
        }
      }
      if (state.filepath !== filepath && onProgress) {
        onProgress(`🔍 Detected real type: ${path.basename(filepath)} → ${path.basename(state.filepath)}`);
      }
    }

    await fs.ensureDir(path.dirname(state.filepath));
    const writer = fs.createWriteStream(state.filepath);

    // Get file size from headers for progress tracking
    const expectedSize = parseInt(response.headers['content-length']) || 0;
    let downloadedSize = 0;
    let lastProgressTime = 0;
    const progressInterval = 1000; // Update progress every 1 second
    // Rolling buffer of last 8 bytes for EOF marker verification
    let streamTail = Buffer.alloc(0);
    // First bytes buffer for magic byte detection (used when Content-Type is ambiguous)
    let streamHead = null;

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
        if (onProgress && expectedSize > 0) {
          const percentage = Math.round((downloadedSize / expectedSize) * 100);
          const downloadedFormatted = formatBytes(downloadedSize);
          const totalFormatted = formatBytes(expectedSize);
          const filename = path.basename(state.filepath);

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
        // Capture first 32 bytes for magic byte detection and PSD header validation
        if (!streamHead || streamHead.length < 32) {
          const combined = streamHead ? Buffer.concat([streamHead, chunk]) : chunk;
          streamHead = combined.slice(0, 32);
        }
        // Keep rolling last-8-bytes buffer for EOF verification
        const combined = Buffer.concat([streamTail, chunk]);
        streamTail = combined.slice(Math.max(0, combined.length - 8));

        const now = Date.now();
        if (now - lastProgressTime >= progressInterval) {
          showProgress();
          lastProgressTime = now;
        }
      });

      // Handle writer events first, before piping
      writer.on('finish', async () => {
        // Verify file size matches expected size
        if (expectedSize > 0 && downloadedSize !== expectedSize) {
          const errorMsg = `Size mismatch: expected ${formatBytes(expectedSize)}, got ${formatBytes(downloadedSize)}`;
          if (onProgress) onProgress(`⚠️  ${path.basename(state.filepath)}: ${errorMsg}`);
          rejectOnce(new Error(errorMsg));
          return;
        }

        // Verify actual file size on disk
        try {
          const stats = await fs.stat(state.filepath);
          if (expectedSize > 0 && stats.size !== expectedSize) {
            const errorMsg = `File size mismatch: expected ${formatBytes(expectedSize)}, file on disk is ${formatBytes(stats.size)}`;
            if (onProgress) onProgress(`⚠️  ${path.basename(state.filepath)}: ${errorMsg}`);
            rejectOnce(new Error(errorMsg));
            return;
          }

          // Verify image EOF markers to detect partial/truncated downloads
          // Only applies to image files large enough to be valid (>= 128 bytes)
          if (downloadedSize >= 128) {
            const eofCheck = checkStreamedEofMarkers(state.filepath, streamTail);
            if (!eofCheck.valid) {
              if (onProgress) onProgress(`⚠️  ${path.basename(state.filepath)}: ${eofCheck.reason}`);
              rejectOnce(new Error(`Size mismatch: ${eofCheck.reason}`));
              return;
            }
          }

          // PSD/PSB-specific validation
          const psdExt = path.extname(state.filepath).toLowerCase();
          if (psdExt === '.psd' || psdExt === '.psb') {
            // Without content-length we cannot verify the download is complete
            if (expectedSize === 0) {
              const errorMsg = 'PSD downloaded without content-length — cannot verify completeness';
              if (onProgress) onProgress(`⚠️  ${path.basename(state.filepath)}: ${errorMsg}`);
              rejectOnce(new Error(`truncated: ${errorMsg}`));
              return;
            }
            // Validate PSD header structure using the first captured bytes
            if (streamHead) {
              const psdCheck = validatePsdHeader(streamHead);
              if (!psdCheck.valid) {
                if (onProgress) onProgress(`⚠️  ${path.basename(state.filepath)}: ${psdCheck.reason}`);
                rejectOnce(new Error(`truncated: ${psdCheck.reason}`));
                return;
              }
            }
          }

          // If still .bin after header detection, try magic bytes as last resort
          if (path.extname(state.filepath).toLowerCase() === '.bin' && streamHead) {
            const magicExt = detectMagicExtension(streamHead);
            if (magicExt) {
              const renamedPath = path.join(
                path.dirname(state.filepath),
                path.basename(state.filepath, '.bin') + magicExt
              );
              try {
                await fs.rename(state.filepath, renamedPath);
                if (onProgress) onProgress(`🔍 Detected real type via magic bytes: ${path.basename(state.filepath)} → ${path.basename(renamedPath)}`);
                state.filepath = renamedPath;
              } catch {
                // Rename failed, keep as .bin
              }
            }
          }

          if (onProgress) onProgress(`✅ Downloaded: ${path.basename(state.filepath)} (${formatBytes(downloadedSize)})`);

          // Return size information for verification
          const result = {
            expectedSize,
            actualSize: downloadedSize,
            filepath: state.filepath
          };

          // For videos, add a small delay to ensure file is fully written
          if (isVideo) {
            setTimeout(() => resolveOnce(result), 50);
          } else {
            resolveOnce(result);
          }
        } catch (statError) {
          rejectOnce(new Error(`Failed to verify file size: ${statError.message}`));
        }
      });

      writer.on('error', (error) => {
        if (onProgress) onProgress(`❌ Failed to save: ${path.basename(state.filepath)} - ${error.message}`);
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

/**
 * Synchronously check EOF markers against the last bytes captured during streaming.
 * Used during download to avoid extra file I/O.
 */
function checkStreamedEofMarkers(filepath, tailBytes) {
  const ext = path.extname(filepath).toLowerCase();

  if (ext === '.jpg' || ext === '.jpeg') {
    if (tailBytes.length < 2 ||
        tailBytes[tailBytes.length - 2] !== 0xFF ||
        tailBytes[tailBytes.length - 1] !== 0xD9) {
      return { valid: false, reason: 'JPEG missing end-of-image marker (FF D9) — file is truncated' };
    }
  } else if (ext === '.png') {
    if (tailBytes.length < 8 || tailBytes.slice(-8).toString('hex') !== '49454e44ae426082') {
      return { valid: false, reason: 'PNG missing IEND chunk — file is truncated' };
    }
  } else if (ext === '.gif') {
    if (tailBytes.length < 1 || tailBytes[tailBytes.length - 1] !== 0x3B) {
      return { valid: false, reason: 'GIF missing trailer byte — file is truncated' };
    }
  }
  return { valid: true };
}

/**
 * Verify image file integrity by checking EOF markers.
 * Detects truncated/partial downloads that result in gray areas.
 * - JPEG: must end with FF D9 (end-of-image marker)
 * - PNG:  must end with IEND chunk (49 45 4E 44 AE 42 60 82)
 * - GIF:  must end with 0x3B (trailer byte)
 */
async function checkImageIntegrity(filepath) {
  const ext = path.extname(filepath).toLowerCase();

  if (!['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
    return { valid: true };
  }

  const stats = await fs.stat(filepath);
  const fileSize = stats.size;

  // Files smaller than a valid image minimum are skipped
  if (fileSize < 128) {
    return { valid: true };
  }

  const fsp = require('fs').promises;
  const fd = await fsp.open(filepath, 'r');
  try {
    if (ext === '.jpg' || ext === '.jpeg') {
      const tail = Buffer.alloc(2);
      await fd.read(tail, 0, 2, fileSize - 2);
      if (tail[0] !== 0xFF || tail[1] !== 0xD9) {
        return { valid: false, reason: 'JPEG missing end-of-image marker (FF D9) — file is truncated' };
      }
    } else if (ext === '.png') {
      const tail = Buffer.alloc(8);
      await fd.read(tail, 0, 8, fileSize - 8);
      if (tail.toString('hex') !== '49454e44ae426082') {
        return { valid: false, reason: 'PNG missing IEND chunk — file is truncated' };
      }
    } else if (ext === '.gif') {
      const tail = Buffer.alloc(1);
      await fd.read(tail, 0, 1, fileSize - 1);
      if (tail[0] !== 0x3B) {
        return { valid: false, reason: 'GIF missing trailer byte — file is truncated' };
      }
    }
    return { valid: true };
  } finally {
    await fd.close();
  }
}

async function savePostMetadata(postDir, postData) {
  const metadataPath = path.join(postDir, 'post-metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(postData, null, 2));
}

/**
 * Save HTML content with localized image paths
 * Replaces remote URLs with local file paths while preserving original URLs
 */
async function saveHtmlContent(postDir, html, downloadedImages = []) {
  const htmlPath = path.join(postDir, 'post.html');

  try {
    // Parse HTML with cheerio
    const $ = cheerio.load(html);

    // Create a map of downloaded files for quick lookup
    const localFiles = await fs.readdir(postDir).catch(() => []);
    const fileMap = new Map();

    // Build map of URL to local filename
    for (const file of localFiles) {
      if (file === 'post.html' || file === 'post-metadata.json') continue;
      fileMap.set(file, file);
    }

    // Also add files from downloadedImages array if provided
    if (downloadedImages && downloadedImages.length > 0) {
      downloadedImages.forEach((img, index) => {
        const url = typeof img === 'string' ? img : img.url;
        const filename = typeof img === 'string'
          ? getImageName(img, index)
          : (img.filename || getImageName(img, index));

        // Try to match by filename
        if (localFiles.includes(filename)) {
          fileMap.set(url, filename);
        }
      });
    }

    // Process <img> tags
    $('img').each((i, elem) => {
      const $img = $(elem);
      const src = $img.attr('src');
      const dataSrc = $img.attr('data-src');

      // Try to find local file for src
      if (src) {
        const localFile = findLocalFile(src, fileMap, localFiles);
        if (localFile) {
          $img.attr('data-original-src', src); // Preserve original URL
          $img.attr('src', localFile); // Replace with local path
        }
      }

      // Try to find local file for data-src
      if (dataSrc) {
        const localFile = findLocalFile(dataSrc, fileMap, localFiles);
        if (localFile) {
          $img.attr('data-original-data-src', dataSrc); // Preserve original URL
          $img.attr('data-src', localFile); // Replace with local path
        }
      }
    });

    // Process <video> tags
    $('video').each((i, elem) => {
      const $video = $(elem);
      const src = $video.attr('src');

      if (src) {
        const localFile = findLocalFile(src, fileMap, localFiles);
        if (localFile) {
          $video.attr('data-original-src', src);
          $video.attr('src', localFile);
        }
      }
    });

    // Process <source> tags (inside video/audio)
    $('source').each((i, elem) => {
      const $source = $(elem);
      const src = $source.attr('src');

      if (src) {
        const localFile = findLocalFile(src, fileMap, localFiles);
        if (localFile) {
          $source.attr('data-original-src', src);
          $source.attr('src', localFile);
        }
      }
    });

    // Process download links (a[download] or a[href$='.zip'] etc)
    $('a[download], a[href*="/data/"], a.fileThumb, a.post__attachment-link').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');

      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const localFile = findLocalFile(href, fileMap, localFiles);
        if (localFile) {
          $link.attr('data-original-href', href); // Preserve original URL
          $link.attr('href', localFile); // Replace with local path
        }
      }
    });

    // Add a meta tag to indicate this is a localized version
    $('head').prepend(`
      <meta name="kemono-downloader" content="localized">
      <meta name="kemono-downloader-note" content="Image URLs have been replaced with local paths. Original URLs preserved in data-original-* attributes.">
      <style>
        /* Add visual indicator for localized content */
        body::before {
          content: "📁 Offline Version - Images loaded locally";
          display: block;
          background: #f0f0f0;
          padding: 10px;
          text-align: center;
          font-family: system-ui, sans-serif;
          border-bottom: 2px solid #ddd;
          position: sticky;
          top: 0;
          z-index: 1000;
        }
      </style>
    `);

    // Save the processed HTML
    await fs.writeFile(htmlPath, $.html());

  } catch (error) {
    // If processing fails, save original HTML as fallback
    console.error(`⚠️  Failed to process HTML for localization: ${error.message}`);
    console.error(`   Saving original HTML instead`);
    await fs.writeFile(htmlPath, html);
  }
}

/**
 * Helper function to find local file matching a remote URL
 */
function findLocalFile(url, fileMap, localFiles) {
  if (!url) return null;

  // Direct match in fileMap
  if (fileMap.has(url)) {
    return fileMap.get(url);
  }

  // Try to extract filename from URL
  const urlObj = new URL(url, 'https://kemono.cr'); // Base URL for relative paths
  const urlPath = urlObj.pathname;
  const filename = path.basename(urlPath);

  // Check if this filename exists locally
  if (localFiles.includes(filename)) {
    return filename;
  }

  // Try to match by partial filename (useful for sanitized names)
  const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');
  for (const localFile of localFiles) {
    if (localFile.includes(filenameWithoutExt) || filenameWithoutExt.includes(localFile.replace(/\.[^.]+$/, ''))) {
      return localFile;
    }
  }

  return null;
}

async function readProfilesFile(filename) {
  const content = await fs.readFile(filename, 'utf8');
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && line.startsWith('http'));
}

/**
 * Save size manifest for post files
 * Stores expected file sizes for verification
 */
async function saveSizeManifest(postDir, sizeInfo) {
  const manifestPath = path.join(postDir, 'size-manifest.json');

  // Load existing manifest if present
  let manifest = {};
  if (await fs.pathExists(manifestPath)) {
    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      manifest = JSON.parse(content);
    } catch (error) {
      // If parsing fails, start fresh
      manifest = {};
    }
  }

  // Update manifest with new size info
  const filename = path.basename(sizeInfo.filepath);
  manifest[filename] = {
    expectedSize: sizeInfo.expectedSize,
    actualSize: sizeInfo.actualSize,
    timestamp: new Date().toISOString()
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Load size manifest for post directory
 */
async function loadSizeManifest(postDir) {
  const manifestPath = path.join(postDir, 'size-manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    return {};
  }

  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

/**
 * Get expected file size from manifest
 */
async function getExpectedSize(postDir, filename) {
  const manifest = await loadSizeManifest(postDir);
  return manifest[filename]?.expectedSize || null;
}

module.exports = {
  downloadImage,
  downloadImageWithRetry,
  downloadMedia,
  downloadMediaWithRetry,
  checkImageIntegrity,
  validatePsdHeader,
  savePostMetadata,
  saveHtmlContent,
  readProfilesFile,
  saveSizeManifest,
  loadSizeManifest,
  getExpectedSize
};
