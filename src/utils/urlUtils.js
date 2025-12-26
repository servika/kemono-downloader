/**
 * URL and path utilities
 */

function extractUserInfo(profileUrl) {
  const urlParts = profileUrl.split('/');
  const userIdIndex = urlParts.indexOf('user') + 1;
  const serviceIndex = urlParts.indexOf('user') - 1;
  
  return {
    userId: urlParts[userIdIndex],
    service: urlParts[serviceIndex]
  };
}

function extractPostId(postUrl) {
  const urlParts = postUrl.split('/');
  return urlParts[urlParts.length - 1] || 'unknown';
}

function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'];
  const urlLower = url.toLowerCase();
  return imageExtensions.some(ext => urlLower.includes(ext));
}

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const videoExtensions = ['.mp4', '.webm', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.m4v', '.3gp', '.ogv'];
  const urlLower = url.toLowerCase();
  return videoExtensions.some(ext => urlLower.includes(ext));
}

function isMediaUrl(url) {
  return isImageUrl(url) || isVideoUrl(url);
}

function getImageName(imageInfo, index) {
  try {
    // If imageInfo is an object with filename, use that
    if (typeof imageInfo === 'object' && imageInfo.filename) {
      // Clean the filename to be filesystem-safe
      return sanitizeFilename(imageInfo.filename);
    }
    
    // If imageInfo is an object with URL, extract from URL
    const imageUrl = typeof imageInfo === 'object' ? imageInfo.url : imageInfo;
    
    const url = new URL(imageUrl);
    const pathname = url.pathname;
    const filename = require('path').basename(pathname);
    
    if (filename && filename.includes('.')) {
      return sanitizeFilename(filename);
    }
  } catch (error) {
    // If URL parsing fails, generate a name
  }
  
  return `image_${index + 1}.jpg`;
}

function sanitizeFilename(filename) {
  // Remove or replace characters that are invalid in filenames
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters with underscore
    .replace(/\s+/g, '_')           // Replace spaces with underscore
    .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
    .replace(/^_|_$/g, '')          // Remove leading/trailing underscores
    .substring(0, 255);             // Limit filename length
}

module.exports = {
  extractUserInfo,
  extractPostId,
  isImageUrl,
  isVideoUrl,
  isMediaUrl,
  getImageName
};