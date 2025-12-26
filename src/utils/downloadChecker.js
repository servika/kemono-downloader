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
      const file = await require('fs').promises.open(imagePath, 'r');
      try {
        const { bytesRead } = await file.read(buffer, 0, 16, 0);
        if (bytesRead === 0) {
          corruptedFiles.push({ name: imageName, reason: 'Cannot read file' });
          continue;
        }

        // Check for common media file signatures
        const isValidMedia = isValidMediaFile(buffer, imageName);
        if (!isValidMedia) {
          corruptedFiles.push({ name: imageName, reason: 'Invalid media format' });
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

function isValidMediaFile(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  
  // Check file signatures (magic numbers) for images
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
  } else if (ext === '.mp4') {
    // MP4 files should have proper box structure
    // Check for common MP4 signatures: ftyp box or free/skip atoms
    if (buffer.length >= 8) {
      const ftyp = buffer.toString('ascii', 4, 8);
      const free = buffer.toString('ascii', 4, 8);
      const skip = buffer.toString('ascii', 4, 8);
      return ftyp === 'ftyp' || free === 'free' || skip === 'skip' || 
             // Check for common MP4 file type brands
             buffer.toString('ascii', 8, 12) === 'isom' ||
             buffer.toString('ascii', 8, 12) === 'mp41' ||
             buffer.toString('ascii', 8, 12) === 'mp42';
    }
    return false;
  } else if (ext === '.webm') {
    // WebM files start with EBML signature
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  } else if (ext === '.avi') {
    // AVI files start with "RIFF" and have "AVI " at offset 8
    const riff = buffer.toString('ascii', 0, 4);
    const avi = buffer.toString('ascii', 8, 12);
    return riff === 'RIFF' && avi === 'AVI ';
  } else if (ext === '.mov') {
    // MOV files have similar structure to MP4 with different signatures
    if (buffer.length >= 8) {
      const ftyp = buffer.toString('ascii', 4, 8);
      return ftyp === 'ftyp' || ftyp === 'moov' || ftyp === 'free';
    }
    return false;
  } else if (ext === '.mkv') {
    // MKV files start with EBML signature like WebM
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  } else if (ext === '.wmv' || ext === '.asf') {
    // WMV/ASF files start with ASF signature
    return buffer[0] === 0x30 && buffer[1] === 0x26 && buffer[2] === 0xB2 && buffer[3] === 0x75;
  } else if (ext === '.flv') {
    // FLV files start with "FLV" signature
    const flv = buffer.toString('ascii', 0, 3);
    return flv === 'FLV';
  } else if (ext === '.m4v' || ext === '.3gp') {
    // M4V and 3GP files are MP4 variants
    if (buffer.length >= 8) {
      const ftyp = buffer.toString('ascii', 4, 8);
      return ftyp === 'ftyp';
    }
    return false;
  } else if (ext === '.ogv') {
    // OGV files start with "OggS" signature
    const oggs = buffer.toString('ascii', 0, 4);
    return oggs === 'OggS';
  }
  
  // For unknown formats, do basic validation - file should have reasonable content
  // Check for HTML error pages or obviously corrupt data
  const content = buffer.toString('ascii', 0, Math.min(buffer.length, 16));
  
  // Reject if it looks like an HTML error page
  if (content.toLowerCase().includes('<html') || 
      content.toLowerCase().includes('<!doctype') ||
      content.includes('404') ||
      content.includes('403') ||
      content.includes('500')) {
    return false;
  }
  
  // If it's all null bytes, it's likely corrupt
  const nonZeroBytes = buffer.filter(byte => byte !== 0).length;
  return nonZeroBytes > 0;
}

async function getDownloadStatus(postDir) {
  try {
    if (!(await fs.pathExists(postDir))) {
      return 'not_started';
    }

    const metadataPath = path.join(postDir, 'post-metadata.json');
    const hasMetadata = await fs.pathExists(metadataPath);

    // Check for any media files (images and videos)
    const files = await fs.readdir(postDir);
    const mediaFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.mp4', '.webm', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.m4v', '.3gp', '.ogv'].includes(ext);
    });

    if (hasMetadata && mediaFiles.length > 0) {
      return 'completed';
    } else if (hasMetadata || mediaFiles.length > 0) {
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