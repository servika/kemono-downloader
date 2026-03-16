const {
  isPostAlreadyDownloaded,
  verifyAllImagesDownloaded,
  getDownloadStatus
} = require('../../src/utils/downloadChecker');
const { extractImagesFromPostData } = require('../../src/extractors/imageExtractor');
const { getImageName } = require('../../src/utils/urlUtils');
const fs = require('fs-extra');
const nodeFs = require('fs');
jest.mock('fs-extra');
jest.mock('../../src/extractors/imageExtractor');
jest.mock('../../src/utils/urlUtils');

describe('downloadChecker', () => {
  let openSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    openSpy = jest.spyOn(nodeFs.promises, 'open');
    getImageName.mockImplementation((imageInfo, index) => `image_${index}.jpg`);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  describe('isPostAlreadyDownloaded', () => {
    test('should return false when directory does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      const result = await isPostAlreadyDownloaded('/test/post', null);

      expect(result).toEqual({
        downloaded: false,
        reason: 'Directory does not exist'
      });
    });

    test('should return false when metadata file is missing', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const result = await isPostAlreadyDownloaded('/test/post', null);

      expect(result).toEqual({
        downloaded: false,
        reason: 'Metadata file missing'
      });
    });

    test('should return true when metadata exists and no postData provided', async () => {
      fs.pathExists.mockResolvedValue(true);

      const result = await isPostAlreadyDownloaded('/test/post', null);

      expect(result).toEqual({
        downloaded: true,
        reason: 'All files present and verified'
      });
    });

    test('should verify images when postData is provided', async () => {
      const postData = {
        post: {
          file: { path: '/image1.jpg', name: 'image1.jpg' }
        }
      };
      const mockImages = [{ url: 'https://example.com/image1.jpg' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      extractImagesFromPostData.mockReturnValue(mockImages);

      const mockFile = {
        read: jest.fn().mockImplementation(async (buffer, bufOffset, length, position) => {
          if (position === 0) {
            buffer.set([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG header
          } else {
            buffer.set([0xFF, 0xD9]); // JPEG EOF marker
          }
          return { bytesRead: length };
        }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await isPostAlreadyDownloaded('/test/post', postData);

      expect(extractImagesFromPostData).toHaveBeenCalledWith(postData);
      expect(result.downloaded).toBe(true);
    });

    test('should return false when images are missing', async () => {
      const postData = {
        post: {
          file: { path: '/image1.jpg', name: 'image1.jpg' }
        }
      };
      const mockImages = [{ url: 'https://example.com/image1.jpg' }];

      fs.pathExists.mockImplementation((target) => {
        if (target === '/test/post') return Promise.resolve(true);
        if (target.endsWith('post-metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      extractImagesFromPostData.mockReturnValue(mockImages);

      const result = await isPostAlreadyDownloaded('/test/post', postData);

      expect(result).toEqual({
        downloaded: false,
        reason: 'Missing images: 1/1',
        missingImages: ['image_0.jpg']
      });
    });

    test('should handle errors gracefully', async () => {
      fs.pathExists.mockRejectedValue(new Error('File system error'));

      const result = await isPostAlreadyDownloaded('/test/post', null);

      expect(result).toEqual({
        downloaded: false,
        reason: 'Error checking: File system error'
      });
    });
  });

  describe('verifyAllImagesDownloaded', () => {
    test('should verify all images are present and valid', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' },
        { url: 'https://example.com/image2.png' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      
      const mockFile = {
        read: jest.fn(),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      getImageName.mockImplementation((imageInfo, index) =>
        index === 0 ? 'image1.jpg' : 'image2.png'
      );

      // Use position to distinguish header vs EOF reads
      mockFile.read.mockImplementation((buffer, bufOffset, length, position) => {
        const filename = getImageName.mock.results[getImageName.mock.results.length - 1]?.value || 'image1.jpg';
        if (position === 0) {
          if (filename.endsWith('.jpg')) {
            buffer.set([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG header
          } else {
            buffer.set([0x89, 0x50, 0x4E, 0x47]); // PNG header
          }
        } else {
          if (filename.endsWith('.jpg')) {
            buffer.set([0xFF, 0xD9]); // JPEG EOF
          } else {
            // PNG IEND: 49 45 4E 44 AE 42 60 82
            buffer.set([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
          }
        }
        return Promise.resolve({ bytesRead: length });
      });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: true,
        presentCount: 2,
        totalExpected: 2,
        missingCount: 0,
        missingFiles: [],
        corruptedFiles: []
      });
    });

    test('should identify missing files', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];

      fs.pathExists.mockResolvedValue(false);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: false,
        presentCount: 0,
        totalExpected: 1,
        missingCount: 1,
        missingFiles: ['image_0.jpg'],
        corruptedFiles: []
      });
    });

    test('should identify empty files', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 0 });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: false,
        presentCount: 0,
        totalExpected: 1,
        missingCount: 1,
        missingFiles: [],
        corruptedFiles: [{ name: 'image_0.jpg', reason: 'Empty file' }]
      });
    });

    test('should identify corrupted files with invalid signatures', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      
      const mockFile = {
        read: jest.fn().mockResolvedValue({ bytesRead: 16 }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      // Mock invalid JPEG signature
      mockFile.read.mockImplementation((buffer) => {
        buffer.set([0x00, 0x00, 0x00, 0x00]); // Invalid signature
        return Promise.resolve({ bytesRead: 16 });
      });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: false,
        presentCount: 0,
        totalExpected: 1,
        missingCount: 1,
        missingFiles: [],
        corruptedFiles: [{ name: 'image_0.jpg', reason: 'Invalid media format' }]
      });
    });

    test('should handle files that cannot be read', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      
      const mockFile = {
        read: jest.fn().mockResolvedValue({ bytesRead: 0 }), // Cannot read
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: false,
        presentCount: 0,
        totalExpected: 1,
        missingCount: 1,
        missingFiles: [],
        corruptedFiles: [{ name: 'image_0.jpg', reason: 'Cannot read file' }]
      });
    });

    test('should handle file access errors', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockRejectedValue(new Error('Permission denied'));

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result).toEqual({
        allPresent: false,
        presentCount: 0,
        totalExpected: 1,
        missingCount: 1,
        missingFiles: ['image_0.jpg'],
        corruptedFiles: []
      });
    });

    test('should validate different image formats', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.gif' },
        { url: 'https://example.com/image2.webp' },
        { url: 'https://example.com/image3.bmp' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockFile = {
        read: jest.fn(),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      getImageName
        .mockReturnValueOnce('image1.gif')
        .mockReturnValueOnce('image2.webp')
        .mockReturnValueOnce('image3.bmp');

      let readCallCount = 0;
      mockFile.read.mockImplementation((buffer, bufOffset, length, position) => {
        if (position > 0) {
          // EOF read for GIF: return trailer byte 0x3B
          buffer.set([0x3B]);
          return Promise.resolve({ bytesRead: length });
        }
        readCallCount++;
        if (readCallCount === 1) {
          // GIF87a signature
          buffer.write('GIF87a', 0, 'ascii');
        } else if (readCallCount === 2) {
          // WebP signature (RIFF + WEBP at offset 8)
          buffer.write('RIFF', 0, 'ascii');
          buffer.write('WEBP', 8, 'ascii');
        } else {
          // BMP signature
          buffer.set([0x42, 0x4D]); // "BM"
        }
        return Promise.resolve({ bytesRead: 16 });
      });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(true);
      expect(result.presentCount).toBe(3);
    });

    test('should validate video file formats', async () => {
      const mockImages = [
        { url: 'https://example.com/video1.mp4' },
        { url: 'https://example.com/video2.webm' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockFile = {
        read: jest.fn(),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      getImageName
        .mockReturnValueOnce('video1.mp4')
        .mockReturnValueOnce('video2.webm');

      let videoReadCount = 0;
      mockFile.read.mockImplementation((buffer, bufOffset, length, position) => {
        videoReadCount++;
        if (videoReadCount === 1) {
          // MP4 signature (ftyp at offset 4)
          buffer.write('ftyp', 4, 'ascii');
        } else {
          // WebM signature (EBML header)
          buffer.set([0x1A, 0x45, 0xDF, 0xA3]);
        }
        return Promise.resolve({ bytesRead: 16 });
      });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(true);
      expect(result.presentCount).toBe(2);
    });

    test('should handle mixed image and video files', async () => {
      const mockImages = [
        { url: 'https://example.com/image.jpg' },
        { url: 'https://example.com/video.mp4' }
      ];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockFile = {
        read: jest.fn(),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      getImageName
        .mockReturnValueOnce('image.jpg')
        .mockReturnValueOnce('video.mp4');

      let mixedReadCount = 0;
      mockFile.read.mockImplementation((buffer, bufOffset, length, position) => {
        if (position > 0) {
          // EOF read for JPEG
          buffer.set([0xFF, 0xD9]);
          return Promise.resolve({ bytesRead: length });
        }
        mixedReadCount++;
        if (mixedReadCount === 1) {
          // JPEG signature
          buffer.set([0xFF, 0xD8, 0xFF, 0xE0]);
        } else {
          // MP4 signature
          buffer.write('ftyp', 4, 'ascii');
        }
        return Promise.resolve({ bytesRead: 16 });
      });

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(true);
      expect(result.presentCount).toBe(2);
    });

    test('should detect truncated JPEG missing EOF marker', async () => {
      const mockImages = [{ url: 'https://example.com/image.jpg' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockFile = {
        read: jest.fn().mockImplementation((buffer, bufOffset, length, position) => {
          if (position === 0) {
            buffer.set([0xFF, 0xD8, 0xFF, 0xE0]); // valid JPEG header
          } else {
            buffer.set([0x00, 0x00]); // missing FF D9 → truncated
          }
          return Promise.resolve({ bytesRead: length });
        }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(false);
      expect(result.corruptedFiles).toEqual([{
        name: 'image_0.jpg',
        reason: 'JPEG missing end-of-image marker (FF D9) — file is truncated'
      }]);
    });

    test('should detect truncated PNG missing IEND chunk', async () => {
      const mockImages = [{ url: 'https://example.com/image.png' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      getImageName.mockReturnValue('image_0.png');

      const mockFile = {
        read: jest.fn().mockImplementation((buffer, bufOffset, length, position) => {
          if (position === 0) {
            buffer.set([0x89, 0x50, 0x4E, 0x47]); // valid PNG header
          } else {
            buffer.fill(0); // missing IEND → truncated
          }
          return Promise.resolve({ bytesRead: length });
        }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(false);
      expect(result.corruptedFiles[0].reason).toContain('PNG missing IEND chunk');
    });

    test('should detect truncated GIF missing trailer byte', async () => {
      const mockImages = [{ url: 'https://example.com/image.gif' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      getImageName.mockReturnValue('image_0.gif');

      const mockFile = {
        read: jest.fn().mockImplementation((buffer, bufOffset, length, position) => {
          if (position === 0) {
            buffer.write('GIF89a', 0, 'ascii'); // valid GIF header
          } else {
            buffer.set([0x00]); // missing 0x3B trailer
          }
          return Promise.resolve({ bytesRead: length });
        }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      expect(result.allPresent).toBe(false);
      expect(result.corruptedFiles[0].reason).toContain('GIF missing trailer byte');
    });

    test('should skip EOF check for small files under 128 bytes', async () => {
      const mockImages = [{ url: 'https://example.com/image.jpg' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 64 }); // under 128-byte threshold

      const mockFile = {
        read: jest.fn().mockImplementation((buffer) => {
          buffer.set([0xFF, 0xD8, 0xFF, 0xE0]); // valid JPEG header, no EOF check
          return Promise.resolve({ bytesRead: 16 });
        }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      const result = await verifyAllImagesDownloaded('/test/post', mockImages);

      // EOF check skipped for tiny files — only header check done
      expect(result.allPresent).toBe(true);
      expect(result.presentCount).toBe(1);
    });
  });

  describe('getDownloadStatus', () => {
    test('should return "not_started" when directory does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('not_started');
    });

    test('should return "completed" when metadata and images exist', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      fs.readdir.mockResolvedValue(['post-metadata.json', 'image1.jpg', 'image2.png']);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('completed');
    });

    test('should return "partial" when only metadata exists', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      fs.readdir.mockResolvedValue(['post-metadata.json']);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('partial');
    });

    test('should return "partial" when only images exist', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      fs.readdir.mockResolvedValue(['image1.jpg']);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('partial');
    });

    test('should return "not_started" when directory exists but is empty', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      fs.readdir.mockResolvedValue([]);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('not_started');
    });

    test('should return "error" when an error occurs', async () => {
      fs.pathExists.mockRejectedValue(new Error('File system error'));

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('error');
    });

    test('should filter image files correctly', async () => {
      fs.pathExists.mockImplementation((path) => {
        if (path === '/test/post') return Promise.resolve(true);
        if (path.endsWith('post-metadata.json')) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      fs.readdir.mockResolvedValue([
        'image1.jpg',
        'image2.jpeg',
        'image3.png',
        'image4.gif',
        'image5.webp',
        'image6.bmp',
        'document.pdf', // Should be filtered out
        'video.mp4',    // Should be filtered out
        'text.txt'      // Should be filtered out
      ]);

      const result = await getDownloadStatus('/test/post');

      expect(result).toBe('partial'); // Has images but no metadata
    });
  });
});
