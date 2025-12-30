const {
  parseGoogleDriveUrl,
  downloadGoogleDriveFile,
  downloadGoogleDriveFolder,
  downloadGoogleDriveLink,
  formatBytes
} = require('../../src/utils/googleDriveDownloader');
const axios = require('axios');
const fs = require('fs-extra');
const config = require('../../src/utils/config');
const { delay } = require('../../src/utils/delay');
const stream = require('stream');

jest.mock('axios');
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

describe('googleDriveDownloader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.getRetryAttempts.mockReturnValue(3);
    config.getRetryDelay.mockReturnValue(1000);
    delay.mockResolvedValue();
  });

  describe('parseGoogleDriveUrl', () => {
    test('should detect file URL (drive.google.com/file/d/)', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/file/d/abc123xyz/view');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://drive.google.com/file/d/abc123xyz/view' });
    });

    test('should detect file URL with query params', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/file/d/abc123xyz/view?usp=sharing');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://drive.google.com/file/d/abc123xyz/view?usp=sharing' });
    });

    test('should detect file URL (open?id=)', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/open?id=abc123xyz');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://drive.google.com/open?id=abc123xyz' });
    });

    test('should detect file URL (uc?id=)', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/uc?id=abc123xyz');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://drive.google.com/uc?id=abc123xyz' });
    });

    test('should detect Google Docs document URL', () => {
      const result = parseGoogleDriveUrl('https://docs.google.com/document/d/abc123xyz/edit');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://docs.google.com/document/d/abc123xyz/edit' });
    });

    test('should detect Google Sheets URL', () => {
      const result = parseGoogleDriveUrl('https://docs.google.com/spreadsheets/d/abc123xyz/edit');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://docs.google.com/spreadsheets/d/abc123xyz/edit' });
    });

    test('should detect Google Slides URL', () => {
      const result = parseGoogleDriveUrl('https://docs.google.com/presentation/d/abc123xyz/edit');
      expect(result).toEqual({ type: 'file', id: 'abc123xyz', url: 'https://docs.google.com/presentation/d/abc123xyz/edit' });
    });

    test('should detect folder URL', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/drive/folders/abc123xyz');
      expect(result).toEqual({ type: 'folder', id: 'abc123xyz', url: 'https://drive.google.com/drive/folders/abc123xyz' });
    });

    test('should detect folder URL with query params', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/drive/folders/abc123xyz?usp=sharing');
      expect(result).toEqual({ type: 'folder', id: 'abc123xyz', url: 'https://drive.google.com/drive/folders/abc123xyz?usp=sharing' });
    });

    test('should detect folder URL with user path', () => {
      const result = parseGoogleDriveUrl('https://drive.google.com/drive/u/0/folders/abc123xyz');
      expect(result).toEqual({ type: 'folder', id: 'abc123xyz', url: 'https://drive.google.com/drive/u/0/folders/abc123xyz' });
    });

    test('should throw error for invalid URL', () => {
      expect(() => parseGoogleDriveUrl('https://invalid.com/file')).toThrow('Invalid Google Drive URL format');
    });

    test('should throw error for null URL', () => {
      expect(() => parseGoogleDriveUrl(null)).toThrow('Invalid Google Drive URL');
    });

    test('should throw error for empty string', () => {
      expect(() => parseGoogleDriveUrl('')).toThrow('Invalid Google Drive URL');
    });

    test('should throw error for non-string URL', () => {
      expect(() => parseGoogleDriveUrl(123)).toThrow('Invalid Google Drive URL');
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

  describe('downloadGoogleDriveFile', () => {
    test('should download file successfully', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test data');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '9'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 9 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      // Immediately emit finish event
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const onProgress = jest.fn();
      const result = await downloadGoogleDriveFile('abc123xyz', '/dest', onProgress);

      expect(result).toEqual({
        success: true,
        filename: 'test.zip',
        size: 9,
        skipped: false
      });
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloading: test.zip'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloaded: test.zip'));
    });

    test('should extract filename from Content-Disposition with quotes', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="vacation photos.zip"',
          'content-length': '4'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 4 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const result = await downloadGoogleDriveFile('abc123xyz', '/dest');

      expect(result.filename).toBe('vacation photos.zip');
    });

    test('should use fallback filename when Content-Disposition is missing', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-length': '4'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 4 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const result = await downloadGoogleDriveFile('abc123xyz', '/dest');

      expect(result.filename).toBe('google_drive_file_abc123xyz');
    });

    test('should skip if file already exists with same size', async () => {
      const mockStream = new stream.PassThrough();
      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '1024'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const onProgress = jest.fn();
      const result = await downloadGoogleDriveFile('abc123xyz', '/dest', onProgress);

      expect(result.skipped).toBe(true);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
      expect(fs.createWriteStream).not.toHaveBeenCalled();
    });

    test('should re-download if file exists with different size', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('new data');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '2048'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(true);
      fs.stat
        .mockResolvedValueOnce({ size: 1024 }) // First call: existing file
        .mockResolvedValueOnce({ size: 2048 }); // Second call: after download
      fs.ensureDir.mockResolvedValue();

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const result = await downloadGoogleDriveFile('abc123xyz', '/dest');

      expect(result.skipped).toBe(false);
      expect(fs.createWriteStream).toHaveBeenCalled();
    });

    test('should re-download if file exists with zero size', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('data');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '1024'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(true);
      fs.stat
        .mockResolvedValueOnce({ size: 0 }) // Corrupted file
        .mockResolvedValueOnce({ size: 1024 }); // After download
      fs.ensureDir.mockResolvedValue();

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const result = await downloadGoogleDriveFile('abc123xyz', '/dest');

      expect(result.skipped).toBe(false);
      expect(fs.createWriteStream).toHaveBeenCalled();
    });

    test('should track download progress', async () => {
      const mockStream = new stream.PassThrough();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '400'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 400 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      // Emit data chunks to trigger progress tracking
      setTimeout(() => {
        mockStream.emit('data', Buffer.alloc(100)); // 25%
        mockStream.emit('data', Buffer.alloc(100)); // 50%
        mockStream.emit('data', Buffer.alloc(100)); // 75%
        mockStream.emit('data', Buffer.alloc(100)); // 100%
        mockWriteStream.emit('finish');
      }, 10);

      const onProgress = jest.fn();
      await downloadGoogleDriveFile('abc123xyz', '/dest', onProgress);

      // Should log at 25%, 50%, 75%, 100%
      const progressCalls = onProgress.mock.calls.filter(call =>
        call[0].includes('%')
      );
      expect(progressCalls.length).toBeGreaterThan(0);
    });

    test('should retry on network error', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '4'
        }
      };

      axios.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockResponse);

      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 4 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const onProgress = jest.fn();
      const result = await downloadGoogleDriveFile('abc123xyz', '/dest', onProgress);

      expect(result.success).toBe(true);
      expect(delay).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retry attempt'));
    });

    test('should use exponential backoff for retries', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '4'
        }
      };

      axios.get
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(mockResponse);

      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 4 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      await downloadGoogleDriveFile('abc123xyz', '/dest');

      // Should call delay with exponential backoff: 1000*1, 1000*2
      expect(delay).toHaveBeenCalledWith(1000); // First retry
      expect(delay).toHaveBeenCalledWith(2000); // Second retry
    });

    test('should throw immediately on 403 error', async () => {
      const error = new Error('Request failed');
      error.response = { status: 403 };
      axios.get.mockRejectedValue(error);

      await expect(downloadGoogleDriveFile('abc123xyz', '/dest'))
        .rejects.toThrow('Google Drive file not accessible (403)');

      expect(delay).not.toHaveBeenCalled(); // No retry
    });

    test('should throw immediately on 404 error', async () => {
      const error = new Error('Not found');
      error.response = { status: 404 };
      axios.get.mockRejectedValue(error);

      await expect(downloadGoogleDriveFile('abc123xyz', '/dest'))
        .rejects.toThrow('Google Drive file not accessible (404)');

      expect(delay).not.toHaveBeenCalled(); // No retry
    });

    test('should throw after all retry attempts exhausted', async () => {
      axios.get.mockRejectedValue(new Error('Persistent network error'));
      fs.pathExists.mockResolvedValue(false);

      const onProgress = jest.fn();
      await expect(downloadGoogleDriveFile('abc123xyz', '/dest', onProgress))
        .rejects.toThrow('Persistent network error');

      expect(delay).toHaveBeenCalledTimes(2); // 3 attempts = 2 delays
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retry attempt 2/3'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retry attempt 3/3'));
    });
  });

  describe('downloadGoogleDriveFolder', () => {
    test('should gracefully skip folder download', async () => {
      const onProgress = jest.fn();
      const result = await downloadGoogleDriveFolder('abc123xyz', '/dest', onProgress);

      expect(result).toEqual({
        success: false,
        filesDownloaded: 0,
        filesFailed: 0,
        filesSkipped: 0,
        totalSize: 0,
        isFolderSkipped: true
      });

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Cannot download folders without API key'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('external-links.json'));
    });

    test('should work without progress callback', async () => {
      const result = await downloadGoogleDriveFolder('abc123xyz', '/dest');

      expect(result.isFolderSkipped).toBe(true);
    });
  });

  describe('downloadGoogleDriveLink', () => {
    test('should route file URL to downloadGoogleDriveFile', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '1024'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const result = await downloadGoogleDriveLink(
        'https://drive.google.com/file/d/abc123xyz/view',
        '/dest'
      );

      expect(result.filesDownloaded).toBe(1);
      expect(result.filesFailed).toBe(0);
      expect(result.filesSkipped).toBe(0);
      expect(result.totalSize).toBe(1024);
    });

    test('should route folder URL to downloadGoogleDriveFolder', async () => {
      const result = await downloadGoogleDriveLink(
        'https://drive.google.com/drive/folders/abc123xyz',
        '/dest'
      );

      expect(result.isFolderSkipped).toBe(true);
      expect(result.filesDownloaded).toBe(0);
    });

    test('should return correct stats for skipped file', async () => {
      const mockStream = new stream.PassThrough();
      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '1024'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });

      const result = await downloadGoogleDriveLink(
        'https://drive.google.com/file/d/abc123xyz/view',
        '/dest'
      );

      expect(result.filesDownloaded).toBe(0);
      expect(result.filesSkipped).toBe(1);
      expect(result.totalSize).toBe(1024);
    });

    test('should return correct stats for failed file', async () => {
      const error = new Error('Download failed');
      error.response = { status: 403 };
      axios.get.mockRejectedValue(error);

      await expect(downloadGoogleDriveLink(
        'https://drive.google.com/file/d/abc123xyz/view',
        '/dest'
      )).rejects.toThrow('Google Drive file not accessible');
    });

    test('should handle invalid URL', async () => {
      await expect(downloadGoogleDriveLink('https://invalid.com/file', '/dest'))
        .rejects.toThrow('Invalid Google Drive URL format');
    });

    test('should pass progress callback to file download', async () => {
      const mockStream = new stream.PassThrough();
      mockStream.push('test');
      mockStream.end();

      const mockResponse = {
        data: mockStream,
        headers: {
          'content-disposition': 'attachment; filename="test.zip"',
          'content-length': '1024'
        }
      };

      axios.get.mockResolvedValue(mockResponse);
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 1024 });

      const mockWriteStream = new stream.PassThrough();
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      setTimeout(() => mockWriteStream.emit('finish'), 10);

      const onProgress = jest.fn();
      await downloadGoogleDriveLink(
        'https://drive.google.com/file/d/abc123xyz/view',
        '/dest',
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('[Google Drive]'));
    });

    test('should pass progress callback to folder download', async () => {
      const onProgress = jest.fn();
      await downloadGoogleDriveLink(
        'https://drive.google.com/drive/folders/abc123xyz',
        '/dest',
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Cannot download folders'));
    });
  });
});