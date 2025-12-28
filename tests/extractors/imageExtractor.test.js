const {
  extractImagesFromPostData,
  extractImagesFromHTML,
  extractMediaFromPostData,
  extractMediaFromHTML
} = require('../../src/extractors/imageExtractor');
const cheerio = require('cheerio');

jest.mock('../../src/utils/urlUtils', () => ({
  isImageUrl: jest.fn(),
  isVideoUrl: jest.fn(),
  isArchiveUrl: jest.fn(),
  isMediaUrl: jest.fn(),
  isDownloadableUrl: jest.fn()
}));

const { isImageUrl, isVideoUrl, isArchiveUrl, isMediaUrl, isDownloadableUrl } = require('../../src/utils/urlUtils');

describe('imageExtractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    isImageUrl.mockImplementation(url => {
      if (!url || typeof url !== 'string') return false;
      return /\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg)($|\?)/i.test(url);
    });
    
    isVideoUrl.mockImplementation(url => {
      if (!url || typeof url !== 'string') return false;
      return /\.(mp4|webm|avi|mov|wmv|flv|mkv|m4v|3gp|ogv)($|\?)/i.test(url);
    });
    
    isArchiveUrl.mockImplementation(url => {
      if (!url || typeof url !== 'string') return false;
      return /\.(zip|rar|7z|tar|tar\.gz|tar\.bz2|tar\.xz)($|\?)/i.test(url);
    });
    
    isMediaUrl.mockImplementation(url => {
      return isImageUrl(url) || isVideoUrl(url);
    });
    
    isDownloadableUrl.mockImplementation(url => {
      return isImageUrl(url) || isVideoUrl(url) || isArchiveUrl(url);
    });

    // Mock console.log to avoid test output noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  describe('extractMediaFromPostData', () => {
    test('should extract main file from post data', () => {
      const postData = {
        post: {
          file: {
            path: '/data/image1.jpg',
            name: 'main-image.jpg'
          }
        }
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/data/image1.jpg',
        filename: 'main-image.jpg',
        type: 'main',
        mediaType: 'image'
      });
    });

    test('should extract video main file', () => {
      const postData = {
        post: {
          file: {
            path: '/data/video1.mp4',
            name: 'main-video.mp4'
          }
        }
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/data/video1.mp4',
        filename: 'main-video.mp4',
        type: 'main',
        mediaType: 'video'
      });
    });

    test('should extract attachments from post data', () => {
      const postData = {
        post: {
          attachments: [
            {
              path: '/data/attachment1.png',
              name: 'attachment1.png'
            },
            {
              path: '/data/video.mp4',
              name: 'video.mp4'
            }
          ]
        }
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/data/attachment1.png',
        filename: 'attachment1.png',
        type: 'attachment',
        mediaType: 'image'
      });
      expect(result[1]).toEqual({
        url: 'https://kemono.cr/data/video.mp4',
        filename: 'video.mp4',
        type: 'attachment',
        mediaType: 'video'
      });
    });

    test('should extract previews from post data', () => {
      const postData = {
        previews: [
          {
            server: 'https://img.kemono.cr',
            path: '/preview1.jpg',
            name: 'preview1.jpg',
            type: 'thumbnail'
          }
        ]
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://img.kemono.cr/preview1.jpg',
        filename: 'preview1.jpg',
        type: 'preview',
        mediaType: 'image'
      });
    });

    test('should avoid duplicate images from previews', () => {
      const postData = {
        post: {
          file: {
            path: '/data/image1.jpg',
            name: 'main-image.jpg'
          }
        },
        previews: [
          {
            server: 'https://img.kemono.cr',
            path: '/data/image1.jpg', // Same path as main file
            name: 'duplicate.jpg'
          }
        ]
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(1); // Should only have main file, not duplicate
      expect(result[0].type).toBe('main');
    });

    test('should extract from legacy string paths', () => {
      const postData = {
        file: {
          path: '/legacy/image.jpg'
        }
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/legacy/image.jpg',
        filename: null,
        type: 'legacy',
        mediaType: 'image'
      });
    });

    test('should extract from content text with regex', () => {
      const postData = {
        content: 'Check out this image: https://example.com/image.png and this video: https://example.com/video.mp4'
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://example.com/image.png',
        filename: null,
        type: 'content',
        mediaType: 'image'
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/video.mp4',
        filename: null,
        type: 'content',
        mediaType: 'video'
      });
    });

    test('should handle legacy attachment arrays', () => {
      const postData = {
        images: [
          '/legacy/image1.jpg',
          {
            path: '/legacy/image2.png',
            name: 'named-image.png'
          }
        ]
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/legacy/image1.jpg',
        filename: null,
        type: 'legacy',
        mediaType: 'image'
      });
      expect(result[1]).toEqual({
        url: 'https://kemono.cr/legacy/image2.png',
        filename: 'named-image.png',
        type: 'legacy',
        mediaType: 'image'
      });
    });

    test('should return empty array on error', () => {
      // Create a postData object that will throw an error when accessed
      const postData = {};
      Object.defineProperty(postData, 'post', {
        get: () => { throw new Error('Test error'); }
      });

      const result = extractMediaFromPostData(postData);

      expect(result).toEqual([]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error extracting media'));
    });

    test('should extract archive files', () => {
      const postData = {
        post: {
          attachments: [
            {
              path: '/data/archive.zip',
              name: 'archive.zip'
            },
            {
              path: '/data/compressed.rar',
              name: 'compressed.rar'
            }
          ]
        }
      };

      const result = extractMediaFromPostData(postData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/data/archive.zip',
        filename: 'archive.zip',
        type: 'attachment',
        mediaType: 'archive'
      });
      expect(result[1]).toEqual({
        url: 'https://kemono.cr/data/compressed.rar',
        filename: 'compressed.rar',
        type: 'attachment',
        mediaType: 'archive'
      });
    });

    test('should handle empty/null post data', () => {
      expect(extractMediaFromPostData({})).toEqual([]);
      expect(extractMediaFromPostData(null)).toEqual([]);
      expect(extractMediaFromPostData(undefined)).toEqual([]);
    });
  });

  describe('extractMediaFromHTML', () => {
    test('should extract images from HTML', () => {
      const html = `
        <div class="post__content">
          <img src="/image1.jpg" />
          <img data-src="https://example.com/image2.png" />
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/image1.jpg',
        mediaType: 'image',
        type: 'html'
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/image2.png',
        mediaType: 'image',
        type: 'html'
      });
    });

    test('should extract videos from HTML', () => {
      const html = `
        <div class="post__content">
          <video src="/video1.mp4"></video>
          <video>
            <source src="https://example.com/video2.webm" />
          </video>
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/video1.mp4',
        mediaType: 'video',
        type: 'html'
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/video2.webm',
        mediaType: 'video',
        type: 'html'
      });
    });

    test('should extract attachment links', () => {
      const html = `
        <div class="post__attachment">
          <a href="/attachment1.jpg">Image Attachment</a>
          <a href="https://example.com/video.mp4">Video Attachment</a>
          <a href="/document.pdf">Non-media file</a>
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(2); // PDF should be filtered out
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/attachment1.jpg',
        mediaType: 'image',
        type: 'html'
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/video.mp4',
        mediaType: 'video',
        type: 'html'
      });
    });

    test('should handle empty HTML', () => {
      const $ = cheerio.load('<div></div>');
      const result = extractMediaFromHTML($);
      expect(result).toEqual([]);
    });

    test('should extract archive attachments from HTML', () => {
      const html = `
        <div class="post__attachment">
          <a href="/archive.zip">Download Archive</a>
          <a href="https://example.com/file.rar">RAR File</a>
          <a href="/image.jpg">Image File</a>
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/archive.zip',
        mediaType: 'archive',
        type: 'html'
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/file.rar',
        mediaType: 'archive',
        type: 'html'
      });
      expect(result[2]).toEqual({
        url: 'https://kemono.cr/image.jpg',
        mediaType: 'image',
        type: 'html'
      });
    });

    test('should handle thumbnail images', () => {
      const html = `
        <div class="post__thumbnail">
          <img src="/thumb.jpg" />
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://kemono.cr/thumb.jpg',
        mediaType: 'image',
        type: 'html'
      });
    });

    test('should extract full-size images from inlineThumb links, not thumbnails', () => {
      // Real-world scenario from kemono.cr
      const html = `
        <div class="post__content">
          <a href="https://n1.kemono.cr/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg" class="inlineThumb">
            <img src="//img.kemono.cr/thumbnail/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg"
                 data-src="https://n1.kemono.cr/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg">
          </a>
          <a href="https://n1.kemono.cr/data/be/3a/be3a7a653d77afb9d60330f1f09518e6751beb7a0b45e0658035f62e45d37401.jpg" class="inlineThumb">
            <img src="//img.kemono.cr/thumbnail/data/be/3a/be3a7a653d77afb9d60330f1f09518e6751beb7a0b45e0658035f62e45d37401.jpg"
                 data-src="https://n1.kemono.cr/data/be/3a/be3a7a653d77afb9d60330f1f09518e6751beb7a0b45e0658035f62e45d37401.jpg">
          </a>
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      // Should extract full-size images from href, not thumbnails from img src
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://n1.kemono.cr/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg',
        mediaType: 'image',
        type: 'html'
      });
      expect(result[1]).toEqual({
        url: 'https://n1.kemono.cr/data/be/3a/be3a7a653d77afb9d60330f1f09518e6751beb7a0b45e0658035f62e45d37401.jpg',
        mediaType: 'image',
        type: 'html'
      });

      // Verify no thumbnail URLs were extracted
      result.forEach(item => {
        expect(item.url).not.toContain('/thumbnail/');
        expect(item.url).not.toContain('img.kemono.cr/thumbnail');
      });
    });

    test('should extract full-size images from fileThumb links', () => {
      const html = `
        <div class="post__files">
          <div class="post__thumbnail">
            <a class="fileThumb image-link" href="https://n1.kemono.cr/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg?f=test.jpg" download="test.jpg">
              <img data-src="//img.kemono.cr/thumbnail/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg" loading="lazy"
                   src="//img.kemono.cr/thumbnail/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg">
            </a>
          </div>
        </div>
      `;
      const $ = cheerio.load(html);

      const result = extractMediaFromHTML($);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://n1.kemono.cr/data/47/b1/47b15e9a817a5810c70a91f26616b7743247fef02aab726841e28f20c51989c3.jpg?f=test.jpg',
        mediaType: 'image',
        type: 'html'
      });
      expect(result[0].url).not.toContain('/thumbnail/');
    });
  });

  describe('backward compatibility', () => {
    test('extractImagesFromPostData should be alias for extractMediaFromPostData', () => {
      expect(extractImagesFromPostData).toBe(extractMediaFromPostData);
    });

    test('extractImagesFromHTML should be alias for extractMediaFromHTML', () => {
      expect(extractImagesFromHTML).toBe(extractMediaFromHTML);
    });
  });
});