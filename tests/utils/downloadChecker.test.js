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
        read: jest.fn().mockImplementation(async (buffer) => {
          buffer.set([0xFF, 0xD8, 0xFF, 0xE0]);
          return { bytesRead: 16 };
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
      
      const mockBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG signature
      const mockFile = {
        read: jest.fn().mockResolvedValue({ bytesRead: 16 }),
        close: jest.fn().mockResolvedValue()
      };
      nodeFs.promises.open.mockResolvedValue(mockFile);

      getImageName.mockImplementation((imageInfo, index) => 
        index === 0 ? 'image1.jpg' : 'image2.png'
      );

      // Mock PNG signature for second image
      mockFile.read.mockImplementation((buffer) => {
        if (getImageName.mock.calls.length <= 1) {
          // First call - JPEG
          buffer.set([0xFF, 0xD8, 0xFF, 0xE0]);
        } else {
          // Second call - PNG
          buffer.set([0x89, 0x50, 0x4E, 0x47]);
        }
        return Promise.resolve({ bytesRead: 16 });
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

      mockFile.read.mockImplementation((buffer) => {
        const callCount = mockFile.read.mock.calls.length;
        if (callCount === 1) {
          // GIF87a signature
          buffer.write('GIF87a', 0, 'ascii');
        } else if (callCount === 2) {
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
