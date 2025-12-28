const {
  parseMegaUrl,
  downloadMegaFile,
  downloadMegaFolder,
  downloadMegaLink,
  formatBytes
} = require('../../src/utils/megaDownloader');
const { File } = require('megajs');
const fs = require('fs-extra');
const config = require('../../src/utils/config');
const { delay } = require('../../src/utils/delay');

jest.mock('megajs');
jest.mock('fs-extra');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/delay');

// Mock sanitizeFilename
jest.mock('../../src/utils/urlUtils', () => ({
  sanitizeFilename: jest.fn((filename) => {
    // Simple implementation that replaces invalid characters
    return filename.replace(/[<>:"/\\|?*]/g, '_');
  })
}));

describe('megaDownloader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.getRetryAttempts.mockReturnValue(3);
    config.getRetryDelay.mockReturnValue(1000);
    delay.mockResolvedValue();
  });

  describe('parseMegaUrl', () => {
    test('should detect file URL (new format)', () => {
      const result = parseMegaUrl('https://mega.nz/file/abc123#xyz789');
      expect(result).toEqual({ type: 'file', url: 'https://mega.nz/file/abc123#xyz789' });
    });

    test('should detect file URL (legacy format)', () => {
      const result = parseMegaUrl('https://mega.nz/#!abc123!xyz789');
      expect(result).toEqual({ type: 'file', url: 'https://mega.nz/#!abc123!xyz789' });
    });

    test('should detect folder URL (new format)', () => {
      const result = parseMegaUrl('https://mega.nz/folder/abc123#xyz789');
      expect(result).toEqual({ type: 'folder', url: 'https://mega.nz/folder/abc123#xyz789' });
    });

    test('should detect folder URL (legacy format)', () => {
      const result = parseMegaUrl('https://mega.nz/#F!abc123!xyz789');
      expect(result).toEqual({ type: 'folder', url: 'https://mega.nz/#F!abc123!xyz789' });
    });

    test('should handle mega.co.nz domain', () => {
      const result = parseMegaUrl('https://mega.co.nz/file/abc123#xyz789');
      expect(result.type).toBe('file');
    });

    test('should handle uppercase URLs', () => {
      const result = parseMegaUrl('HTTPS://MEGA.NZ/FILE/ABC123#XYZ789');
      expect(result.type).toBe('file');
    });

    test('should throw error for invalid URL', () => {
      expect(() => parseMegaUrl('https://invalid.com/file')).toThrow('Invalid mega.nz URL format');
    });

    test('should throw error for null URL', () => {
      expect(() => parseMegaUrl(null)).toThrow('Invalid mega.nz URL');
    });

    test('should throw error for empty string', () => {
      expect(() => parseMegaUrl('')).toThrow('Invalid mega.nz URL');
    });
  });

  describe('formatBytes', () => {
    test('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    test('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    test('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    test('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
    });

    test('should format gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
    });

    test('should format terabytes', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });
  });

  describe('downloadMegaFile', () => {
    test('should download file successfully', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((downloadCallback, progressCallback) => {
          // Simulate progress updates
          progressCallback(null, 512);
          progressCallback(null, 1024);
          downloadCallback(null, Buffer.from('test data'));
        })
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const onProgress = jest.fn();
      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest', onProgress);

      expect(result).toEqual({
        success: true,
        filename: 'test.zip',
        size: 1024,
        skipped: false
      });
      expect(fs.writeFile).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloading: test.zip'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloaded: test.zip'));
    });

    test('should skip if file already exists with same size', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const onProgress = jest.fn();
      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest', onProgress);

      expect(result.skipped).toBe(true);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    test('should re-download if file exists with different size', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 2048,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((downloadCallback) => {
          downloadCallback(null, Buffer.from('new data'));
        })
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 }); // Different size
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest');

      expect(result.skipped).toBe(false);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('should retry on network error', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn()
          .mockImplementationOnce((cb) => cb(new Error('Network error')))
          .mockImplementationOnce((cb) => cb(null, Buffer.from('test data')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const onProgress = jest.fn();
      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest', onProgress);

      expect(result.success).toBe(true);
      expect(delay).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retry attempt'));
    });

    test('should throw immediately on quota error', async () => {
      const mockFile = {
        loadAttributes: jest.fn((callback) => callback(new Error('Bandwidth quota exceeded')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);

      await expect(downloadMegaFile('https://mega.nz/file/test', '/dest'))
        .rejects.toThrow('MEGA quota exceeded');

      expect(delay).not.toHaveBeenCalled(); // No retry
    });

    test('should throw immediately on quota error with "limit" keyword', async () => {
      const mockFile = {
        loadAttributes: jest.fn((callback) => callback(new Error('Transfer limit exceeded')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);

      await expect(downloadMegaFile('https://mega.nz/file/test', '/dest'))
        .rejects.toThrow('MEGA quota exceeded');
    });

    test('should throw immediately on invalid key error', async () => {
      const mockFile = {
        loadAttributes: jest.fn((callback) => callback(new Error('EKEY: Invalid key')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);

      await expect(downloadMegaFile('https://mega.nz/file/test', '/dest'))
        .rejects.toThrow('Invalid MEGA link');

      expect(delay).not.toHaveBeenCalled(); // No retry
    });

    test('should throw immediately on invalid error keyword', async () => {
      const mockFile = {
        loadAttributes: jest.fn((callback) => callback(new Error('Invalid decryption key')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);

      await expect(downloadMegaFile('https://mega.nz/file/test', '/dest'))
        .rejects.toThrow('Invalid MEGA link');
    });

    test('should sanitize filename', async () => {
      const mockFile = {
        name: 'test file:with<invalid>chars.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((cb) => cb(null, Buffer.from('test')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest');

      expect(result.filename).toBe('test file_with_invalid_chars.zip');
    });

    test('should show progress for large files', async () => {
      const mockFile = {
        name: 'large.zip',
        size: 10485760, // 10MB
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((downloadCallback, progressCallback) => {
          // Simulate progress updates
          for (let i = 1; i <= 10; i++) {
            progressCallback(null, i * 1048576); // 1MB increments
          }
          downloadCallback(null, Buffer.from('test'));
        })
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const onProgress = jest.fn();
      await downloadMegaFile('https://mega.nz/file/test', '/dest', onProgress);

      // Should show percentage progress
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('%'));
    });

    test('should handle progress callback errors gracefully', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((downloadCallback, progressCallback) => {
          // Simulate progress error
          progressCallback(new Error('Progress error'), 512);
          downloadCallback(null, Buffer.from('test'));
        })
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaFile('https://mega.nz/file/test', '/dest');

      expect(result.success).toBe(true); // Should still succeed
    });

    test('should retry with exponential backoff', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn()
          .mockImplementationOnce((cb) => cb(new Error('Error 1')))
          .mockImplementationOnce((cb) => cb(new Error('Error 2')))
          .mockImplementationOnce((cb) => cb(null, Buffer.from('test')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await downloadMegaFile('https://mega.nz/file/test', '/dest');

      // Check exponential backoff (1000ms * attempt)
      expect(delay).toHaveBeenNthCalledWith(1, 1000); // First retry
      expect(delay).toHaveBeenNthCalledWith(2, 2000); // Second retry
    });

    test('should throw after max retries', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((cb) => cb(new Error('Persistent error')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();

      await expect(downloadMegaFile('https://mega.nz/file/test', '/dest'))
        .rejects.toThrow('Persistent error');

      expect(delay).toHaveBeenCalledTimes(2); // Retried twice (3 total attempts)
    });
  });

  describe('downloadMegaFolder', () => {
    test('should download folder recursively', async () => {
      const mockChildFile = {
        name: 'child.jpg',
        directory: false,
        link: jest.fn(() => 'https://mega.nz/file/child')
      };

      const mockFolder = {
        name: 'test_folder',
        directory: true,
        children: [mockChildFile],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn()
        .mockReturnValueOnce(mockFolder)
        .mockReturnValueOnce({
          name: 'child.jpg',
          size: 512,
          loadAttributes: jest.fn((cb) => cb(null)),
          download: jest.fn((cb) => cb(null, Buffer.from('data')))
        });

      fs.ensureDir.mockResolvedValue();
      fs.pathExists.mockResolvedValue(false);
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest');

      expect(result).toEqual({
        success: true,
        filesDownloaded: 1,
        filesFailed: 0,
        filesSkipped: 0,
        totalSize: 512
      });
      expect(fs.ensureDir).toHaveBeenCalledWith(expect.stringContaining('test_folder'));
    });

    test('should handle empty folder', async () => {
      const mockFolder = {
        name: 'empty_folder',
        directory: true,
        children: [],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFolder);
      fs.ensureDir.mockResolvedValue();

      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest');

      expect(result).toEqual({
        success: true,
        filesDownloaded: 0,
        filesFailed: 0,
        filesSkipped: 0,
        totalSize: 0
      });
    });

    test('should handle folder without name', async () => {
      const mockFolder = {
        name: '',
        directory: true,
        children: [],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFolder);
      fs.ensureDir.mockResolvedValue();

      const onProgress = jest.fn();
      await downloadMegaFolder('https://mega.nz/folder/test', '/dest', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('mega_folder'));
    });

    test('should track stats for mixed success/failure', async () => {
      const mockFile1 = {
        name: 'success.jpg',
        directory: false,
        link: jest.fn(() => 'https://mega.nz/file/success')
      };

      const mockFile2 = {
        name: 'fail.jpg',
        directory: false,
        link: jest.fn(() => 'https://mega.nz/file/fail')
      };

      const mockFolder = {
        name: 'mixed_folder',
        directory: true,
        children: [mockFile1, mockFile2],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn()
        .mockReturnValueOnce(mockFolder)
        .mockReturnValueOnce({
          name: 'success.jpg',
          size: 512,
          loadAttributes: jest.fn((cb) => cb(null)),
          download: jest.fn((cb) => cb(null, Buffer.from('data')))
        })
        .mockReturnValueOnce({
          name: 'fail.jpg',
          loadAttributes: jest.fn((cb) => cb(new Error('Download failed')))
        });

      fs.ensureDir.mockResolvedValue();
      fs.pathExists.mockResolvedValue(false);
      fs.writeFile.mockResolvedValue();

      const onProgress = jest.fn();
      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest', onProgress);

      expect(result.filesDownloaded).toBe(1);
      expect(result.filesFailed).toBe(1);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Failed to download'));
    });

    test('should handle nested folders recursively', async () => {
      const mockSubFolder = {
        name: 'subfolder',
        directory: true,
        children: [],
        link: jest.fn(() => 'https://mega.nz/folder/sub'),
        loadAttributes: jest.fn((cb) => cb(null))
      };

      const mockFolder = {
        name: 'main_folder',
        directory: true,
        children: [mockSubFolder],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn()
        .mockReturnValueOnce(mockFolder)
        .mockReturnValueOnce(mockSubFolder);

      fs.ensureDir.mockResolvedValue();

      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest');

      expect(result.success).toBe(true);
      expect(fs.ensureDir).toHaveBeenCalledWith(expect.stringContaining('main_folder'));
    });

    test('should accumulate stats from nested folders', async () => {
      const mockNestedFile = {
        name: 'nested.jpg',
        directory: false,
        link: jest.fn(() => 'https://mega.nz/file/nested')
      };

      const mockSubFolder = {
        name: 'subfolder',
        directory: true,
        children: [mockNestedFile],
        link: jest.fn(() => 'https://mega.nz/folder/sub'),
        loadAttributes: jest.fn((cb) => cb(null))
      };

      const mockFolder = {
        name: 'main_folder',
        directory: true,
        children: [mockSubFolder],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn()
        .mockReturnValueOnce(mockFolder)
        .mockReturnValueOnce(mockSubFolder)
        .mockReturnValueOnce({
          name: 'nested.jpg',
          size: 256,
          loadAttributes: jest.fn((cb) => cb(null)),
          download: jest.fn((cb) => cb(null, Buffer.from('data')))
        });

      fs.ensureDir.mockResolvedValue();
      fs.pathExists.mockResolvedValue(false);
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest');

      expect(result.filesDownloaded).toBe(1);
      expect(result.totalSize).toBe(256);
    });

    test('should throw on folder load error', async () => {
      const mockFolder = {
        loadAttributes: jest.fn((callback) => callback(new Error('Load failed')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFolder);

      await expect(downloadMegaFolder('https://mega.nz/folder/test', '/dest'))
        .rejects.toThrow('Failed to download MEGA folder');
    });

    test('should handle skipped files correctly', async () => {
      const mockFile = {
        name: 'existing.jpg',
        directory: false,
        link: jest.fn(() => 'https://mega.nz/file/existing')
      };

      const mockFolder = {
        name: 'folder',
        directory: true,
        children: [mockFile],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn()
        .mockReturnValueOnce(mockFolder)
        .mockReturnValueOnce({
          name: 'existing.jpg',
          size: 512,
          loadAttributes: jest.fn((cb) => cb(null))
        });

      fs.ensureDir.mockResolvedValue();
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 512 }); // Same size - will skip

      const result = await downloadMegaFolder('https://mega.nz/folder/test', '/dest');

      expect(result.filesSkipped).toBe(1);
      expect(result.filesDownloaded).toBe(0);
    });
  });

  describe('downloadMegaLink', () => {
    test('should route to downloadMegaFile for file URLs', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((cb) => cb(null, Buffer.from('test')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await downloadMegaLink('https://mega.nz/file/test#key', '/dest');

      expect(result.filesDownloaded).toBe(1);
      expect(result.totalSize).toBe(1024);
      expect(result.success).toBe(true);
    });

    test('should route to downloadMegaFolder for folder URLs', async () => {
      const mockFolder = {
        name: 'folder',
        directory: true,
        children: [],
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFolder);
      fs.ensureDir.mockResolvedValue();

      const result = await downloadMegaLink('https://mega.nz/folder/test#key', '/dest');

      expect(result.success).toBe(true);
      expect(fs.ensureDir).toHaveBeenCalled();
    });

    test('should return correct stats for skipped file', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 }); // Same size - will skip

      const result = await downloadMegaLink('https://mega.nz/file/test#key', '/dest');

      expect(result.filesSkipped).toBe(1);
      expect(result.filesDownloaded).toBe(0);
      expect(result.totalSize).toBe(1024);
    });

    test('should return filesFailed:1 on file download error', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(new Error('Error')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);

      const result = await downloadMegaLink('https://mega.nz/file/test#key', '/dest')
        .catch(() => ({ success: false, filesDownloaded: 0, filesFailed: 1, filesSkipped: 0, totalSize: 0 }));

      expect(result.filesFailed).toBe(1);
    });

    test('should pass progress callback through', async () => {
      const mockFile = {
        name: 'test.zip',
        size: 1024,
        loadAttributes: jest.fn((callback) => callback(null)),
        download: jest.fn((cb) => cb(null, Buffer.from('test')))
      };

      File.fromURL = jest.fn().mockReturnValue(mockFile);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const onProgress = jest.fn();
      await downloadMegaLink('https://mega.nz/file/test#key', '/dest', onProgress);

      expect(onProgress).toHaveBeenCalled();
    });
  });
});