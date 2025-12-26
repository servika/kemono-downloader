const fs = require('fs-extra');
const path = require('path');
const { extractImagesFromPostData } = require('../extractors/imageExtractor');
const { getImageName } = require('./urlUtils');

/**
 * Download verification utilities
 */

async function isPostAlreadyDownloaded(postDir, postData) {
  try {
    // Check if directory exists
    if (!(await fs.pathExists(postDir))) {
      return { downloaded: false, reason: 'Directory does not exist' };
    }

    // Check if metadata exists
    const metadataPath = path.join(postDir, 'post-metadata.json');
    if (!(await fs.pathExists(metadataPath))) {
      return { downloaded: false, reason: 'Metadata file missing' };
    }

    // If we have post data, verify all expected images are present
    if (postData) {
      const expectedImages = extractImagesFromPostData(postData);
      if (expectedImages.length > 0) {
        const imageCheck = await verifyAllImagesDownloaded(postDir, expectedImages);
        if (!imageCheck.allPresent) {
          return { 
            downloaded: false, 
            reason: `Missing images: ${imageCheck.missingCount}/${expectedImages.length}`,
            missingImages: imageCheck.missingFiles
          };
        }
      }
    }

    return { downloaded: true, reason: 'All files present and verified' };
  } catch (error) {
    return { downloaded: false, reason: `Error checking: ${error.message}` };
  }
}

async function verifyAllImagesDownloaded(postDir, expectedImages) {
  const missingFiles = [];
  const corruptedFiles = [];
  let presentCount = 0;

  for (let i = 0; i < expectedImages.length; i++) {
    const imageInfo = expectedImages[i];
    const imageName = getImageName(imageInfo, i);
    const imagePath = path.join(postDir, imageName);

    try {
      // Check if file exists
      if (!(await fs.pathExists(imagePath))) {
        missingFiles.push(imageName);
        continue;
      }

      // Check if file is not empty and appears to be a valid image
      const stats = await fs.stat(imagePath);
      if (stats.size === 0) {
        corruptedFiles.push({ name: imageName, reason: 'Empty file' });
        continue;
      }

      // Basic file integrity check - read first few bytes to verify it's not corrupted
      const buffer = Buffer.alloc(16);
      const file = await fs.open(imagePath, 'r');
      try {
        const { bytesRead } = await file.read(buffer, 0, 16, 0);
        if (bytesRead === 0) {
          corruptedFiles.push({ name: imageName, reason: 'Cannot read file' });
          continue;
        }

        // Check for common image file signatures
        const isValidImage = isValidImageFile(buffer, imageName);
        if (!isValidImage) {
          corruptedFiles.push({ name: imageName, reason: 'Invalid image format' });
          continue;
        }

        presentCount++;
      } finally {
        await file.close();
      }

    } catch (error) {
      missingFiles.push(imageName);
    }
  }

  return {
    allPresent: missingFiles.length === 0 && corruptedFiles.length === 0,
    presentCount,
    totalExpected: expectedImages.length,
    missingCount: missingFiles.length + corruptedFiles.length,
    missingFiles,
    corruptedFiles
  };
}

function isValidImageFile(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  
  // Check file signatures (magic numbers)
  if (ext === '.jpg' || ext === '.jpeg') {
    // JPEG files start with FF D8
    return buffer[0] === 0xFF && buffer[1] === 0xD8;
  } else if (ext === '.png') {
    // PNG files start with 89 50 4E 47
    return buffer[0] === 0x89 && buffer[1] === 0x50 && 
           buffer[2] === 0x4E && buffer[3] === 0x47;
  } else if (ext === '.gif') {
    // GIF files start with "GIF87a" or "GIF89a"
    const header = buffer.toString('ascii', 0, 6);
    return header === 'GIF87a' || header === 'GIF89a';
  } else if (ext === '.webp') {
    // WebP files have "RIFF" at start and "WEBP" at offset 8
    const riff = buffer.toString('ascii', 0, 4);
    const webp = buffer.toString('ascii', 8, 12);
    return riff === 'RIFF' && webp === 'WEBP';
  } else if (ext === '.bmp') {
    // BMP files start with "BM"
    return buffer[0] === 0x42 && buffer[1] === 0x4D;
  }
  
  // For other formats or if we can't determine, assume valid if file has content
  return true;
}

async function getDownloadStatus(postDir) {
  try {
    if (!(await fs.pathExists(postDir))) {
      return 'not_started';
    }

    const metadataPath = path.join(postDir, 'post-metadata.json');
    const hasMetadata = await fs.pathExists(metadataPath);

    // Check for any image files
    const files = await fs.readdir(postDir);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
    });

    if (hasMetadata && imageFiles.length > 0) {
      return 'completed';
    } else if (hasMetadata || imageFiles.length > 0) {
      return 'partial';
    } else {
      return 'not_started';
    }
  } catch (error) {
    return 'error';
  }
}

module.exports = {
  isPostAlreadyDownloaded,
  verifyAllImagesDownloaded,
  getDownloadStatus
};