/**
 * @fileoverview URL parsing, validation, and path sanitization utilities
 * Provides security-hardened functions for URL validation, filename sanitization,
 * and media type detection to prevent SSRF, path traversal, and other security vulnerabilities
 */

/**
 * Validates a URL and checks for security issues (SSRF prevention)
 * Ensures URL uses http/https protocols and does not target private networks
 *
 * @param {string} url - URL to validate
 * @returns {URL} Parsed URL object if valid
 * @throws {Error} If URL is invalid, uses unsupported protocol, or targets private networks
 *
 * @example
 * const validUrl = validateUrl('https://example.com/image.jpg');
 * // Throws: validateUrl('http://localhost/file') // Private network blocked
 * // Throws: validateUrl('file:///etc/passwd')    // Unsupported protocol
 */
function validateUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const allowedProtocols = ['http:', 'https:'];
    
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }
    
    // Prevent localhost/private network access for security
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || 
        hostname.startsWith('127.') || 
        hostname.startsWith('192.168.') || 
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')) {
      throw new Error('Private network access not allowed');
    }
    
    return parsedUrl;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

/**
 * Extracts service and user ID from a kemono.cr profile URL
 *
 * @param {string} profileUrl - Full profile URL (e.g., 'https://kemono.cr/patreon/user/12345')
 * @returns {{userId: string, service: string}} Object containing userId and service name
 *
 * @example
 * extractUserInfo('https://kemono.cr/patreon/user/12345')
 * // Returns: { userId: '12345', service: 'patreon' }
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

/**
 * Extracts and sanitizes profile username from HTML using Cheerio
 * Tries multiple selectors to find the username, with fallbacks to meta tags and URL patterns
 *
 * @param {CheerioAPI} $ - Cheerio instance loaded with profile HTML
 * @param {Object} userInfo - User information object
 * @param {string} userInfo.userId - User ID from URL
 * @param {string} [userInfo.profileUrl] - Full profile URL for fallback extraction
 * @returns {string} Sanitized username safe for filesystem use
 *
 * @example
 * const $ = cheerio.load(html);
 * const username = extractProfileName($, { userId: '12345', profileUrl: 'https://...' });
 * // Returns: 'Artist_Name' or 'user_12345' as fallback
 */
function extractProfileName($, userInfo) {
  // Try to extract username from various HTML selectors
  const selectors = [
    '.user-header__info span[itemprop="name"]',
    '.user-header__profile h1',
    '.user-header h1',
    '.user-info h1',
    'h1.user-name',
    'h1',
    '[data-username]',
    '.username'
  ];
  
  let username = null;
  
  for (const selector of selectors) {
    const element = $(selector);
    if (element.length > 0) {
      const text = element.text().trim();
      if (text && text.length > 0 && !text.toLowerCase().includes('kemono')) {
        username = text;
        break;
      }
    }
  }
  
  // If no username found, try data attributes
  if (!username) {
    const dataUsername = $('[data-username]').attr('data-username');
    if (dataUsername) {
      username = dataUsername;
    }
  }
  
  // If still no username found, try extracting from meta tags
  if (!username) {
    const metaTitle = $('meta[property="og:title"]').attr('content');
    if (metaTitle && !metaTitle.toLowerCase().includes('kemono')) {
      username = metaTitle;
    }
  }
  
  // If still no username, fallback to URL-based extraction or generic name
  if (!username) {
    // Try to extract from URL if it contains username patterns
    const urlPattern = /\/([^\/]+)$/;
    const match = userInfo?.profileUrl?.match(urlPattern);
    if (match && match[1] && match[1] !== userInfo.userId) {
      username = match[1];
    } else {
      username = `user_${userInfo.userId}`;
    }
  }
  
  // Clean and sanitize the username for filesystem use
  return sanitizeFilename(username);
}

/**
 * Extracts post ID from a post URL
 *
 * @param {string} postUrl - Post URL (e.g., 'https://kemono.cr/patreon/user/123/post/456')
 * @returns {string} Post ID or 'unknown' if extraction fails
 *
 * @example
 * extractPostId('https://kemono.cr/patreon/user/123/post/456')
 * // Returns: '456'
 */
function extractPostId(postUrl) {
  const urlParts = postUrl.split('/');
  return urlParts[urlParts.length - 1] || 'unknown';
}

/**
 * Checks if URL points to an image file based on extension
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has an image extension
 *
 * @example
 * isImageUrl('https://example.com/photo.jpg') // true
 * isImageUrl('https://example.com/video.mp4') // false
 */
function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const imageExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.ico', '.avif', '.jxl',
    // RAW camera formats
    '.raw', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
    '.raf', '.orf', '.rw2', '.pef', '.dng', '.x3f', '.3fr', '.erf', '.mrw', '.srw'
  ];
  const urlLower = url.toLowerCase();
  return imageExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Checks if URL points to a video file based on extension
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has a video extension
 *
 * @example
 * isVideoUrl('https://example.com/video.mp4') // true
 * isVideoUrl('https://example.com/photo.jpg') // false
 */
function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const videoExtensions = ['.mp4', '.webm', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.m4v', '.3gp', '.ogv'];
  const urlLower = url.toLowerCase();
  return videoExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Checks if URL points to an archive file based on extension
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has an archive extension
 *
 * @example
 * isArchiveUrl('https://example.com/files.zip') // true
 * isArchiveUrl('https://example.com/photo.jpg') // false
 */
function isArchiveUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const archiveExtensions = ['.zip', '.rar', '.7z', '.tar', '.tar.gz', '.tar.bz2', '.tar.xz'];
  const urlLower = url.toLowerCase();
  return archiveExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Checks if URL points to an audio file based on extension
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has an audio extension
 */
function isAudioUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const audioExtensions = ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.wma', '.m4a', '.opus', '.aiff'];
  const urlLower = url.toLowerCase();
  return audioExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Checks if URL points to a document or project file based on extension
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has a document/project extension
 */
function isDocumentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const documentExtensions = [
    // Documents
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.csv', '.xls', '.xlsx', '.pptx',
    // Design / art project files
    '.psd', '.clip', '.sai', '.sai2', '.ai', '.eps', '.kra', '.xcf', '.afdesign', '.afphoto',
    '.sketch', '.fig', '.indd', '.cdr', '.procreate', '.mdp', '.abr',
    // 3D / model files
    '.blend', '.fbx', '.obj', '.stl',
    // Subtitle files
    '.srt', '.ass', '.vtt',
    // Font files
    '.ttf', '.otf', '.woff', '.woff2',
    // Other common creator files
    '.swf', '.exe', '.apk', '.dmg'
  ];
  const urlLower = url.toLowerCase();
  return documentExtensions.some(ext => urlLower.includes(ext));
}

/**
 * Checks if URL points to a media file (image or video)
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is an image or video
 *
 * @example
 * isMediaUrl('https://example.com/photo.jpg') // true
 * isMediaUrl('https://example.com/video.mp4') // true
 */
function isMediaUrl(url) {
  return isImageUrl(url) || isVideoUrl(url);
}

/**
 * Checks if URL points to any downloadable file type
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is any recognized downloadable type
 *
 * @example
 * isDownloadableUrl('https://example.com/photo.jpg')  // true
 * isDownloadableUrl('https://example.com/files.zip')  // true
 * isDownloadableUrl('https://example.com/art.psd')    // true
 * isDownloadableUrl('https://example.com/page.html')  // false
 */
function isDownloadableUrl(url) {
  return isImageUrl(url) || isVideoUrl(url) || isArchiveUrl(url) || isAudioUrl(url) || isDocumentUrl(url);
}

/**
 * Extracts or generates a sanitized filename from image information
 * Handles both object and string inputs, with fallback to indexed naming
 *
 * @param {Object|string} imageInfo - Image information object with filename/url, or URL string
 * @param {string} [imageInfo.filename] - Original filename
 * @param {string} [imageInfo.url] - Image URL
 * @param {number} index - Index for fallback naming (0-based)
 * @returns {string} Sanitized filename safe for filesystem use
 *
 * @example
 * getImageName({ filename: 'photo.jpg' }, 0)          // 'photo.jpg'
 * getImageName({ url: 'https://ex.com/pic.png' }, 0)  // 'pic.png'
 * getImageName('invalid-url', 5)                      // 'image_6.jpg'
 */
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

/**
 * Sanitizes a filename for safe filesystem use across all platforms
 * Removes invalid characters, handles Windows reserved names, and enforces length limits
 * Critical for preventing path traversal and filesystem security issues
 *
 * @param {string} filename - Original filename to sanitize
 * @returns {string} Sanitized filename safe for Windows, macOS, and Linux filesystems
 *
 * @example
 * sanitizeFilename('file:name?.jpg')      // 'file_name_.jpg'
 * sanitizeFilename('CON')                 // '_CON'
 * sanitizeFilename('  spaces  ')          // 'spaces'
 * sanitizeFilename('very'.repeat(100))    // Truncated to 200 chars
 */
function sanitizeFilename(filename) {
  // Remove or replace characters that are invalid in filenames
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Replace invalid characters including control characters
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, '_$1')  // Handle Windows reserved names
    .replace(/\s+/g, '_')           // Replace spaces with underscore
    .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
    .replace(/^_|_$|^\.|\.$/g, '')  // Remove leading/trailing underscores and dots
    .substring(0, 200);             // Conservative filename length limit
}

/**
 * Validates a file path to prevent directory traversal attacks
 * Ensures the resolved path stays within the current working directory
 *
 * @param {string} filepath - File path to validate
 * @returns {string} Resolved absolute path if valid
 * @throws {Error} If path attempts directory traversal outside CWD
 *
 * @example
 * validateFilePath('./download/file.jpg')        // Valid
 * validateFilePath('../../../etc/passwd')        // Throws error
 * validateFilePath('/absolute/path/file.jpg')    // Throws if outside CWD
 */
function validateFilePath(filepath) {
  const path = require('path');
  const resolved = path.resolve(filepath);
  const cwd = process.cwd();
  
  if (!resolved.startsWith(cwd)) {
    throw new Error('Invalid path: directory traversal detected');
  }
  
  return resolved;
}

module.exports = {
  validateUrl,
  validateFilePath,
  extractUserInfo,
  extractPostId,
  extractProfileName,
  isImageUrl,
  isVideoUrl,
  isArchiveUrl,
  isAudioUrl,
  isDocumentUrl,
  isMediaUrl,
  isDownloadableUrl,
  getImageName,
  sanitizeFilename
};