const {
  downloadImage,
  downloadImageWithRetry,
  downloadMedia,
  downloadMediaWithRetry,
  savePostMetadata,
  saveHtmlContent,
  readProfilesFile,
  validatePsdHeader
} = require('../../src/utils/fileUtils');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('../../src/utils/config');
const { delay } = require('../../src/utils/delay');
const { Readable, PassThrough } = require('stream');

jest.mock('axios');
jest.mock('fs-extra');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/delay');

describe('fileUtils', () => {
  // Helper function to create a proper mock stream setup for successful downloads
  const createSuccessfulDownloadMock = (dataSize = 10, data = null) => {
    const testData = data || Buffer.from('a'.repeat(dataSize));
    const mockStream = new PassThrough();
    const mockWriter = new PassThrough();

    jest.spyOn(mockWriter, 'destroy');

    // Simulate proper data flow through the writer
    mockWriter.on('pipe', (source) => {
      source.on('data', (chunk) => {
        mockWriter.emit('data', chunk);
      });
      source.on('end', () => {
        mockWriter.emit('finish');
      });
    });

    const startStream = () => {
      setImmediate(() => {
        mockStream.write(testData);
        mockStream.end();
      });
    };

    return {
      mockStream,
      mockWriter,
      testData,
      startStream
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock config defaults
    config.get.mockImplementation((key) => {
      const defaults = {
        'api.timeout': 30000,
        'api.userAgent': 'Mozilla/5.0 (compatible; kemono-downloader)'
      };
      return defaults[key];
    });

    config.getRetryAttempts.mockReturnValue(3);
    config.getRetryDelay.mockReturnValue(1000);

    delay.mockResolvedValue();

    // Mock fs.stat for size verification
    fs.stat.mockResolvedValue({ size: 10 });
    fs.pathExists.mockResolvedValue(false);
    fs.remove.mockResolvedValue();
  });

  describe('downloadImage', () => {
    test('should download image successfully', async () => {
      const testData = Buffer.from('image data'); // exactly 10 bytes
      const mockStream = new PassThrough();

      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '10' }
      };

      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      // Simulate proper data flow through the writer
      mockWriter.on('pipe', (source) => {
        source.on('data', (chunk) => {
          mockWriter.emit('data', chunk);
        });
        source.on('end', () => {
          mockWriter.emit('finish');
        });
      });

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      const onProgress = jest.fn();

      // Start download and immediately write data to stream
      const downloadPromise = downloadImage('https://example.com/image.jpg', '/test/image.jpg', onProgress);

      setImmediate(() => {
        mockStream.write(testData);
        mockStream.end();
      });

      await downloadPromise;

      expect(axios).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://example.com/image.jpg',
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; kemono-downloader)'
        }
      });

      expect(fs.ensureDir).toHaveBeenCalledWith('/test');
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloading: image.jpg'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloaded: image.jpg'));
    });

    test('should use extended timeout for video files', async () => {
      const mockStream = Readable.from([Buffer.from('video data')]);
      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '10' }
      };

      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      await downloadImage('https://example.com/video.mp4', '/test/video.mp4');

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        timeout: 150000
      }));
    });

    test('should handle download timeout', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      axios.mockRejectedValue(timeoutError);
      
      const onProgress = jest.fn();
      
      await expect(downloadImage('https://example.com/image.jpg', '/test/image.jpg', onProgress))
        .rejects.toThrow('timeout of 30000ms exceeded');
      
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Download timeout'));
    });

    test('should handle network errors', async () => {
      axios.mockRejectedValue(new Error('Network error'));
      
      const onProgress = jest.fn();
      
      await expect(downloadImage('https://example.com/image.jpg', '/test/image.jpg', onProgress))
        .rejects.toThrow('Network error');
      
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Failed to download image'));
    });

    test('should handle stream errors', async () => {
      const mockStream = new PassThrough();
      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '10' }
      };
      
      axios.mockResolvedValue(mockResponse);
      
      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      
      setImmediate(() => {
        mockStream.emit('error', new Error('Stream error'));
      });
      
      await expect(downloadImage('https://example.com/image.jpg', '/test/image.jpg'))
        .rejects.toThrow('Stream error');
    });

    test('should handle writer errors', async () => {
      const mockStream = new PassThrough();
      
      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '10' }
      };
      
      axios.mockResolvedValue(mockResponse);
      
      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      
      setImmediate(() => {
        mockWriter.emit('error', new Error('Write error'));
      });
      
      const onProgress = jest.fn();
      
      await expect(downloadImage('https://example.com/image.jpg', '/test/image.jpg', onProgress))
        .rejects.toThrow('Write error');
      
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Failed to save'));
    });

    test('should show progress for all files with known size', async () => {
      // Second chunk ends with JPEG EOF marker (FF D9) so integrity check passes
      const chunk1 = Buffer.alloc(512);
      const chunk2 = Buffer.alloc(512);
      chunk2[510] = 0xFF;
      chunk2[511] = 0xD9;
      const chunks = [chunk1, chunk2];
      const mockStream = Readable.from(chunks);
      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '1024' } // 1KB
      };

      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      // Mock stat to return correct file size
      fs.stat.mockResolvedValue({ size: 1024 });
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      const onProgress = jest.fn();

      await downloadImage('https://example.com/small.jpg', '/test/small.jpg', onProgress);

      // Should show progress for all files with known size
      expect(onProgress).toHaveBeenCalledWith(expect.stringMatching(/\d+%/));
    });

    test('should reject when writer closes after partial data', async () => {
      const mockStream = new PassThrough();
      const mockResponse = {
        data: mockStream,
        headers: { 'content-length': '20' }
      };

      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      const downloadPromise = downloadImage('https://example.com/image.jpg', '/test/image.jpg');
      mockStream.write(Buffer.alloc(10));

      setImmediate(() => {
        mockWriter.emit('close');
      });

      await expect(downloadPromise).rejects.toThrow('Download interrupted');
    });
  });

  describe('downloadImageWithRetry', () => {
    test('should retry on server errors', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      axios
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server error' })
        .mockResolvedValueOnce({
          data: mockStream,
          headers: { 'content-length': '10' }
        });
      
      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      
      const onProgress = jest.fn();
      
      await downloadImageWithRetry('https://example.com/image.jpg', '/test/image.jpg', onProgress);
      
      expect(axios).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    });

    test('should not retry on 404 errors', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };
      axios.mockRejectedValue(notFoundError);
      
      await expect(downloadImageWithRetry('https://example.com/image.jpg', '/test/image.jpg'))
        .rejects.toThrow('Not found');
      
      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('should fail after max retry attempts', async () => {
      const serverError = new Error('Server error');
      serverError.response = { status: 500 };
      axios.mockRejectedValue(serverError);
      
      await expect(downloadImageWithRetry('https://example.com/image.jpg', '/test/image.jpg'))
        .rejects.toThrow('Server error');
      
      expect(axios).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(delay).toHaveBeenCalledTimes(2); // 2 retry delays
    });

    test('should retry on timeout errors', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      axios
        .mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout' })
        .mockResolvedValueOnce({
          data: mockStream,
          headers: { 'content-length': '10' }
        });
      
      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      
      await downloadImageWithRetry('https://example.com/image.jpg', '/test/image.jpg');
      
      expect(axios).toHaveBeenCalledTimes(2);
    });

    test('should retry on 403 errors', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      axios
        .mockRejectedValueOnce({ response: { status: 403 }, message: 'Forbidden' })
        .mockResolvedValueOnce({
          data: mockStream,
          headers: { 'content-length': '10' }
        });

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      await downloadImageWithRetry('https://example.com/image.jpg', '/test/image.jpg');

      expect(axios).toHaveBeenCalledTimes(2);
      expect(delay).toHaveBeenCalledWith(1000);
    });

    test('should try thumbnail URL when full resolution returns 404', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };

      axios
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({
          data: mockStream,
          headers: { 'content-length': '10' }
        });

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      const onProgress = jest.fn();

      await downloadImageWithRetry(
        'https://example.com/data/image.jpg',
        '/test/image.jpg',
        onProgress,
        'https://example.com/thumbnail/image.jpg'
      );

      expect(axios).toHaveBeenCalledTimes(2);
      expect(axios).toHaveBeenNthCalledWith(1, expect.objectContaining({
        url: 'https://example.com/data/image.jpg'
      }));
      expect(axios).toHaveBeenNthCalledWith(2, expect.objectContaining({
        url: 'https://example.com/thumbnail/image.jpg'
      }));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('trying thumbnail'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloaded thumbnail'));
    });

    test('should not try thumbnail if full resolution succeeds', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      axios.mockResolvedValueOnce({
        data: mockStream,
        headers: { 'content-length': '10' }
      });

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();

      await downloadImageWithRetry(
        'https://example.com/data/image.jpg',
        '/test/image.jpg',
        null,
        'https://example.com/thumbnail/image.jpg'
      );

      expect(axios).toHaveBeenCalledTimes(1);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/data/image.jpg'
      }));
    });

    test('should fail if both full resolution and thumbnail fail', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };

      axios.mockRejectedValue(notFoundError);

      const onProgress = jest.fn();

      await expect(
        downloadImageWithRetry(
          'https://example.com/data/image.jpg',
          '/test/image.jpg',
          onProgress,
          'https://example.com/thumbnail/image.jpg'
        )
      ).rejects.toThrow('Not found');

      expect(axios).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('trying thumbnail'));
    });

    test('should not try thumbnail for non-404 errors', async () => {
      const serverError = new Error('Server error');
      serverError.response = { status: 500 };

      axios.mockRejectedValue(serverError);

      await expect(
        downloadImageWithRetry(
          'https://example.com/data/image.jpg',
          '/test/image.jpg',
          null,
          'https://example.com/thumbnail/image.jpg'
        )
      ).rejects.toThrow('Server error');

      // Should retry 3 times on 500 error, but not try thumbnail
      expect(axios).toHaveBeenCalledTimes(3);
      // All calls should be to the full resolution URL
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/data/image.jpg'
      }));
    });

    test('should not try thumbnail if thumbnailUrl is null', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };

      axios.mockRejectedValue(notFoundError);

      await expect(
        downloadImageWithRetry(
          'https://example.com/data/image.jpg',
          '/test/image.jpg',
          null,
          null
        )
      ).rejects.toThrow('Not found');

      expect(axios).toHaveBeenCalledTimes(1);
    });

    test('should not try thumbnail if thumbnailUrl is same as imageUrl', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };

      axios.mockRejectedValue(notFoundError);

      await expect(
        downloadImageWithRetry(
          'https://example.com/data/image.jpg',
          '/test/image.jpg',
          null,
          'https://example.com/data/image.jpg'
        )
      ).rejects.toThrow('Not found');

      expect(axios).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadMedia and downloadMediaWithRetry', () => {
    test('downloadMedia should be alias for downloadImage', async () => {
      const mockStream = Readable.from([Buffer.alloc(10)]);

      axios.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '10' }
      });
      
      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');

      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      
      await downloadMedia('https://example.com/video.mp4', '/test/video.mp4');
      
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/video.mp4'
      }));
    });

    test('downloadMediaWithRetry should be alias for downloadImageWithRetry', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.response = { status: 404 };
      axios.mockRejectedValue(notFoundError);
      
      await expect(downloadMediaWithRetry('https://example.com/video.mp4', '/test/video.mp4'))
        .rejects.toThrow('Not found');
      
      expect(axios).toHaveBeenCalledTimes(1);
    });
  });

  describe('savePostMetadata', () => {
    test('should save post metadata as JSON', async () => {
      const postData = {
        id: '123',
        title: 'Test Post',
        content: 'Post content'
      };
      
      fs.writeFile.mockResolvedValue();
      
      await savePostMetadata('/test/post', postData);
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/post/post-metadata.json',
        JSON.stringify(postData, null, 2)
      );
    });
  });

  describe('saveHtmlContent', () => {
    test('should save HTML content', async () => {
      const html = '<html><body>Test</body></html>';
      
      fs.writeFile.mockResolvedValue();
      
      await saveHtmlContent('/test/post', html);
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/post/post.html',
        html
      );
    });
  });

  // Helper: build a valid 32-byte PSD header buffer
  function makePsdHeader({ magic = true, version = 1, reservedZero = true, channels = 3, height = 100, width = 100, bitDepth = 8, colorMode = 3 } = {}) {
    const buf = Buffer.alloc(32);
    if (magic) { buf[0] = 0x38; buf[1] = 0x42; buf[2] = 0x50; buf[3] = 0x53; }
    buf.writeUInt16BE(version, 4);
    if (!reservedZero) buf[6] = 0xFF;
    buf.writeUInt16BE(channels, 12);
    buf.writeUInt32BE(height, 14);
    buf.writeUInt32BE(width, 18);
    buf.writeUInt16BE(bitDepth, 22);
    buf.writeUInt16BE(colorMode, 24);
    return buf;
  }

  describe('validatePsdHeader', () => {
    test('accepts a valid PSD header (version 1)', () => {
      expect(validatePsdHeader(makePsdHeader())).toEqual({ valid: true });
    });

    test('accepts a valid PSB header (version 2)', () => {
      expect(validatePsdHeader(makePsdHeader({ version: 2 }))).toEqual({ valid: true });
    });

    test('accepts bit depths 1, 8, 16, 32', () => {
      for (const bitDepth of [1, 8, 16, 32]) {
        expect(validatePsdHeader(makePsdHeader({ bitDepth }))).toEqual({ valid: true });
      }
    });

    test('rejects null / too-short buffer', () => {
      expect(validatePsdHeader(null).valid).toBe(false);
      expect(validatePsdHeader(Buffer.alloc(10)).valid).toBe(false);
      expect(validatePsdHeader(null).reason).toMatch(/too small/);
    });

    test('rejects missing magic bytes', () => {
      const result = validatePsdHeader(makePsdHeader({ magic: false }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/magic bytes/);
    });

    test('rejects invalid version', () => {
      const result = validatePsdHeader(makePsdHeader({ version: 0 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/version/);
    });

    test('rejects non-zero reserved bytes', () => {
      const result = validatePsdHeader(makePsdHeader({ reservedZero: false }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/reserved/);
    });

    test('rejects channel count 0', () => {
      const result = validatePsdHeader(makePsdHeader({ channels: 0 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/channel/);
    });

    test('rejects channel count 57', () => {
      const result = validatePsdHeader(makePsdHeader({ channels: 57 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/channel/);
    });

    test('rejects zero height', () => {
      const result = validatePsdHeader(makePsdHeader({ height: 0 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/zero/);
    });

    test('rejects zero width', () => {
      const result = validatePsdHeader(makePsdHeader({ width: 0 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/zero/);
    });

    test('rejects invalid bit depth', () => {
      const result = validatePsdHeader(makePsdHeader({ bitDepth: 24 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/bit depth/);
    });
  });

  describe('PSD download validation', () => {
    // Helper: build a 512-byte buffer starting with a valid PSD header
    function makePsdData(size = 512) {
      const buf = Buffer.alloc(size);
      buf.set(makePsdHeader());
      return buf;
    }

    test('should accept a PSD download with valid header and content-length', async () => {
      const psdData = makePsdData();
      const mockStream = Readable.from([psdData]);
      const mockResponse = { data: mockStream, headers: { 'content-length': '512' } };
      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 512 });

      const onProgress = jest.fn();
      await downloadImage('https://example.com/file.psd', '/test/file.psd', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloaded: file.psd'));
    });

    test('should reject PSD download when no content-length header', async () => {
      const psdData = makePsdData();
      const mockStream = Readable.from([psdData]);
      const mockResponse = { data: mockStream, headers: {} };
      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 512 });

      const onProgress = jest.fn();
      await expect(downloadImage('https://example.com/file.psd', '/test/file.psd', onProgress))
        .rejects.toThrow('cannot verify completeness');

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('cannot verify completeness'));
    });

    test('should reject PSD download with invalid header magic bytes', async () => {
      const badData = Buffer.alloc(512, 0xAA); // no valid header
      const mockStream = Readable.from([badData]);
      const mockResponse = { data: mockStream, headers: { 'content-length': '512' } };
      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 512 });

      const onProgress = jest.fn();
      await expect(downloadImage('https://example.com/file.psd', '/test/file.psd', onProgress))
        .rejects.toThrow('magic bytes');

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('magic bytes'));
    });

    test('should retry PSD download after missing content-length failure', async () => {
      const psdData = makePsdData();

      const writer1 = new PassThrough();
      jest.spyOn(writer1, 'destroy');

      const writer2 = new PassThrough();
      jest.spyOn(writer2, 'destroy');

      axios
        .mockResolvedValueOnce({ data: Readable.from([Buffer.from(psdData)]), headers: {} })
        .mockResolvedValueOnce({ data: Readable.from([Buffer.from(psdData)]), headers: { 'content-length': '512' } });

      fs.createWriteStream
        .mockReturnValueOnce(writer1)
        .mockReturnValueOnce(writer2);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 512 });
      fs.pathExists.mockResolvedValue(true);

      const onProgress = jest.fn();
      await downloadImageWithRetry('https://example.com/file.psd', '/test/file.psd', onProgress);

      expect(axios).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    });

    test('should validate .psb files the same as .psd', async () => {
      const psbData = makePsdData();
      const mockStream = Readable.from([psbData]);
      const mockResponse = { data: mockStream, headers: {} };
      axios.mockResolvedValue(mockResponse);

      const mockWriter = new PassThrough();
      jest.spyOn(mockWriter, 'destroy');
      fs.createWriteStream.mockReturnValue(mockWriter);
      fs.ensureDir.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 512 });

      await expect(downloadImage('https://example.com/file.psb', '/test/file.psb'))
        .rejects.toThrow('cannot verify completeness');
    });
  });

  describe('readProfilesFile', () => {
    test('should read and parse profiles file', async () => {
      const fileContent = `
        https://kemono.cr/patreon/user/123
        # This is a comment
        
        https://kemono.cr/fanbox/user/456
        invalid-line
        http://example.com/user/789
      `;
      
      fs.readFile.mockResolvedValue(fileContent);
      
      const result = await readProfilesFile('profiles.txt');
      
      expect(result).toEqual([
        'https://kemono.cr/patreon/user/123',
        'https://kemono.cr/fanbox/user/456',
        'http://example.com/user/789'
      ]);
      
      expect(fs.readFile).toHaveBeenCalledWith('profiles.txt', 'utf8');
    });

    test('should handle empty profiles file', async () => {
      fs.readFile.mockResolvedValue('');
      
      const result = await readProfilesFile('empty.txt');
      
      expect(result).toEqual([]);
    });

    test('should filter out non-HTTP lines', async () => {
      const fileContent = `
        https://kemono.cr/patreon/user/123
        ftp://example.com/user/456
        not-a-url
        mailto:test@example.com
      `;
      
      fs.readFile.mockResolvedValue(fileContent);
      
      const result = await readProfilesFile('profiles.txt');
      
      expect(result).toEqual([
        'https://kemono.cr/patreon/user/123'
      ]);
    });
  });
});
