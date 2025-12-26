const {
  validateUrl,
  validateFilePath,
  extractUserInfo,
  extractPostId,
  extractProfileName,
  isImageUrl,
  isVideoUrl,
  isArchiveUrl,
  isMediaUrl,
  isDownloadableUrl,
  getImageName,
  sanitizeFilename
} = require('../../src/utils/urlUtils');
const cheerio = require('cheerio');

describe('urlUtils', () => {
  describe('validateUrl', () => {
    test('should validate valid HTTP URLs', () => {
      const url = validateUrl('http://example.com');
      expect(url.hostname).toBe('example.com');
      expect(url.protocol).toBe('http:');
    });

    test('should validate valid HTTPS URLs', () => {
      const url = validateUrl('https://kemono.cr/patreon/user/123');
      expect(url.hostname).toBe('kemono.cr');
      expect(url.protocol).toBe('https:');
    });

    test('should reject invalid protocols', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow('Unsupported protocol: ftp:');
      expect(() => validateUrl('file:///etc/passwd')).toThrow('Unsupported protocol: file:');
    });

    test('should reject localhost URLs', () => {
      expect(() => validateUrl('http://localhost:3000')).toThrow('Private network access not allowed');
      expect(() => validateUrl('https://127.0.0.1')).toThrow('Private network access not allowed');
      expect(() => validateUrl('http://192.168.1.1')).toThrow('Private network access not allowed');
    });

    test('should reject malformed URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
      expect(() => validateUrl('')).toThrow('Invalid URL');
    });
  });

  describe('extractUserInfo', () => {
    test('should extract user info from kemono URL', () => {
      const result = extractUserInfo('https://kemono.cr/patreon/user/12345');
      expect(result).toEqual({
        userId: '12345',
        service: 'patreon'
      });
    });

    test('should extract user info from fanbox URL', () => {
      const result = extractUserInfo('https://kemono.cr/fanbox/user/67890');
      expect(result).toEqual({
        userId: '67890',
        service: 'fanbox'
      });
    });
  });

  describe('extractPostId', () => {
    test('should extract post ID from URL', () => {
      expect(extractPostId('https://kemono.cr/patreon/user/123/post/456')).toBe('456');
      expect(extractPostId('https://example.com/posts/789')).toBe('789');
    });

    test('should return "unknown" for URLs without post ID', () => {
      expect(extractPostId('https://example.com/')).toBe('unknown');
      expect(extractPostId('https://example.com/posts/')).toBe('unknown');
    });
  });

  describe('extractProfileName', () => {
    test('should extract username from page selectors', () => {
      const html = `
        <div class="user-header__info">
          <span itemprop="name">Test User</span>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = extractProfileName($, { userId: '123' });
      expect(result).toBe('Test_User');
    });

    test('should use data-username attribute when available', () => {
      const html = `<div data-username="Data User"></div>`;
      const $ = cheerio.load(html);
      const result = extractProfileName($, { userId: '123' });
      expect(result).toBe('Data_User');
    });

    test('should use og:title meta tag fallback', () => {
      const html = `<meta property="og:title" content="Meta User">`;
      const $ = cheerio.load(html);
      const result = extractProfileName($, { userId: '123' });
      expect(result).toBe('Meta_User');
    });

    test('should fall back to URL-based username or userId', () => {
      const $ = cheerio.load('<div></div>');
      const resultFromUrl = extractProfileName($, {
        userId: '123',
        profileUrl: 'https://kemono.cr/boosty/user/some_user'
      });
      const resultFromId = extractProfileName($, { userId: '123' });

      expect(resultFromUrl).toBe('some_user');
      expect(resultFromId).toBe('user_123');
    });
  });

  describe('isImageUrl', () => {
    test('should identify image URLs correctly', () => {
      expect(isImageUrl('https://example.com/image.jpg')).toBe(true);
      expect(isImageUrl('https://example.com/image.jpeg')).toBe(true);
      expect(isImageUrl('https://example.com/image.png')).toBe(true);
      expect(isImageUrl('https://example.com/image.gif')).toBe(true);
      expect(isImageUrl('https://example.com/image.webp')).toBe(true);
    });

    test('should reject non-image URLs', () => {
      expect(isImageUrl('https://example.com/video.mp4')).toBe(false);
      expect(isImageUrl('https://example.com/document.pdf')).toBe(false);
      expect(isImageUrl('not-a-url')).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(isImageUrl(null)).toBe(false);
      expect(isImageUrl(undefined)).toBe(false);
      expect(isImageUrl('')).toBe(false);
      expect(isImageUrl(123)).toBe(false);
    });
  });

  describe('isVideoUrl', () => {
    test('should identify video URLs correctly', () => {
      expect(isVideoUrl('https://example.com/video.mp4')).toBe(true);
      expect(isVideoUrl('https://example.com/video.webm')).toBe(true);
      expect(isVideoUrl('https://example.com/video.avi')).toBe(true);
      expect(isVideoUrl('https://example.com/video.mov')).toBe(true);
    });

    test('should reject non-video URLs', () => {
      expect(isVideoUrl('https://example.com/image.jpg')).toBe(false);
      expect(isVideoUrl('https://example.com/document.pdf')).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(isVideoUrl(null)).toBe(false);
      expect(isVideoUrl(undefined)).toBe(false);
      expect(isVideoUrl('')).toBe(false);
    });
  });

  describe('isArchiveUrl', () => {
    test('should identify archive URLs correctly', () => {
      expect(isArchiveUrl('https://example.com/archive.zip')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.rar')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.7z')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.tar')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.tar.gz')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.tar.bz2')).toBe(true);
      expect(isArchiveUrl('https://example.com/archive.tar.xz')).toBe(true);
    });

    test('should reject non-archive URLs', () => {
      expect(isArchiveUrl('https://example.com/image.jpg')).toBe(false);
      expect(isArchiveUrl('https://example.com/video.mp4')).toBe(false);
      expect(isArchiveUrl('https://example.com/document.pdf')).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(isArchiveUrl(null)).toBe(false);
      expect(isArchiveUrl(undefined)).toBe(false);
      expect(isArchiveUrl('')).toBe(false);
      expect(isArchiveUrl(123)).toBe(false);
    });
  });

  describe('isMediaUrl', () => {
    test('should identify media URLs (images and videos)', () => {
      expect(isMediaUrl('https://example.com/image.jpg')).toBe(true);
      expect(isMediaUrl('https://example.com/video.mp4')).toBe(true);
      expect(isMediaUrl('https://example.com/document.pdf')).toBe(false);
      expect(isMediaUrl('https://example.com/archive.zip')).toBe(false);
    });
  });

  describe('isDownloadableUrl', () => {
    test('should identify downloadable URLs (images, videos, and archives)', () => {
      expect(isDownloadableUrl('https://example.com/image.jpg')).toBe(true);
      expect(isDownloadableUrl('https://example.com/video.mp4')).toBe(true);
      expect(isDownloadableUrl('https://example.com/archive.zip')).toBe(true);
      expect(isDownloadableUrl('https://example.com/document.pdf')).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(isDownloadableUrl(null)).toBe(false);
      expect(isDownloadableUrl(undefined)).toBe(false);
      expect(isDownloadableUrl('')).toBe(false);
    });
  });

  describe('getImageName', () => {
    test('should extract filename from URL', () => {
      expect(getImageName('https://example.com/path/image.jpg', 0)).toBe('image.jpg');
      expect(getImageName('https://example.com/photo.png', 1)).toBe('photo.png');
    });

    test('should use filename from object', () => {
      const imageInfo = { filename: 'custom-name.jpg', url: 'https://example.com/xyz' };
      expect(getImageName(imageInfo, 0)).toBe('custom-name.jpg');
    });

    test('should sanitize filenames', () => {
      const imageInfo = { filename: 'file<>name.jpg' };
      expect(getImageName(imageInfo, 0)).toBe('file_name.jpg');
    });

    test('should generate fallback name', () => {
      expect(getImageName('https://example.com/', 5)).toBe('image_6.jpg');
      expect(getImageName('invalid-url', 0)).toBe('image_1.jpg');
    });
  });

  describe('sanitizeFilename', () => {
    test('should remove invalid characters', () => {
      expect(sanitizeFilename('file<>name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file:name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file|name?.txt')).toBe('file_name_.txt');
    });

    test('should handle Windows reserved names', () => {
      expect(sanitizeFilename('CON')).toBe('CON');
      expect(sanitizeFilename('PRN.txt')).toBe('PRN.txt');
      expect(sanitizeFilename('NUL')).toBe('NUL');
    });

    test('should replace spaces and multiple underscores', () => {
      expect(sanitizeFilename('file name with spaces.txt')).toBe('file_name_with_spaces.txt');
      expect(sanitizeFilename('file___name.txt')).toBe('file_name.txt');
    });

    test('should trim leading/trailing underscores and dots', () => {
      expect(sanitizeFilename('_filename_.txt')).toBe('filename_.txt');
      expect(sanitizeFilename('.filename.')).toBe('filename');
    });

    test('should limit filename length', () => {
      const longName = 'a'.repeat(250) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
    });
  });

  describe('validateFilePath', () => {
    test('should validate safe file paths', () => {
      const safePath = validateFilePath('./test-file.txt');
      expect(safePath).toContain(process.cwd());
    });

    test('should reject directory traversal attempts', () => {
      expect(() => validateFilePath('../../../etc/passwd')).toThrow('directory traversal detected');
      expect(() => validateFilePath('/etc/passwd')).toThrow('directory traversal detected');
    });
  });
});
