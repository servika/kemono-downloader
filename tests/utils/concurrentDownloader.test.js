const ConcurrentDownloader = require('../../src/utils/concurrentDownloader');
const { downloadImageWithRetry } = require('../../src/utils/fileUtils');
const { delay } = require('../../src/utils/delay');
const config = require('../../src/utils/config');
const fs = require('fs-extra');
const { getImageName } = require('../../src/utils/urlUtils');

jest.mock('../../src/utils/fileUtils');
jest.mock('../../src/utils/delay');
jest.mock('../../src/utils/config');
jest.mock('fs-extra');
jest.mock('../../src/utils/urlUtils');

describe('ConcurrentDownloader', () => {
  let downloader;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock config defaults
    config.getMaxConcurrentImages.mockReturnValue(3);
    config.getRetryAttempts.mockReturnValue(3);
    config.getRetryDelay.mockReturnValue(1000);
    config.getImageDelay.mockReturnValue(200);
    config.shouldShowSkippedFiles.mockReturnValue(true);
    config.shouldShowVerboseProgress.mockReturnValue(true);
    config.shouldShowDetailedErrors.mockReturnValue(true);
    
    // Mock delay to resolve immediately
    delay.mockResolvedValue();
    
    // Mock getImageName
    getImageName.mockImplementation((imageInfo, index) => `image_${index}.jpg`);
    
    // Mock file system
    fs.pathExists.mockResolvedValue(false);
    fs.stat.mockResolvedValue({ size: 1024 });
    
    downloader = new ConcurrentDownloader();
  });

  describe('constructor', () => {
    test('should initialize with correct defaults', () => {
      expect(downloader.activeSemaphore).toBe(0);
      expect(downloader.maxConcurrent).toBe(3);
      expect(downloader.stats).toEqual({
        completed: 0,
        failed: 0,
        skipped: 0
      });
    });
  });

  describe('downloadImages', () => {
    test('should handle empty image array', async () => {
      const onComplete = jest.fn();
      
      const result = await downloader.downloadImages([], '/test/dir', null, onComplete);
      
      expect(onComplete).toHaveBeenCalledWith({
        completed: 0,
        failed: 0,
        skipped: 0
      });
      expect(result).toBeUndefined();
    });

    test('should download multiple images successfully', async () => {
      const images = [
        { url: 'https://example.com/image1.jpg' },
        { url: 'https://example.com/image2.jpg' }
      ];
      
      downloadImageWithRetry.mockResolvedValue();

      const onProgress = jest.fn();
      const onComplete = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress, onComplete);

      expect(downloadImageWithRetry).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledWith({
        completed: 2,
        failed: 0,
        skipped: 0
      });
    });

    test('should skip existing files', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];
      
      // Mock file exists with valid size
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      
      const onProgress = jest.fn();
      const onComplete = jest.fn();
      
      await downloader.downloadImages(images, '/test/dir', onProgress, onComplete);
      
      expect(downloadImageWithRetry).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
      expect(onComplete).toHaveBeenCalledWith({
        completed: 0,
        failed: 0,
        skipped: 1
      });
    });

    test('should handle successful downloads with internal retries', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];

      // downloadImageWithRetry handles retries internally
      downloadImageWithRetry.mockResolvedValueOnce();

      const onProgress = jest.fn();
      const onComplete = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress, onComplete);

      expect(downloadImageWithRetry).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith({
        completed: 1,
        failed: 0,
        skipped: 0
      });
    });

    test('should handle final download failure', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];

      // downloadImageWithRetry handles retries internally and still fails
      downloadImageWithRetry.mockRejectedValue(new Error('Network error'));

      const onProgress = jest.fn();
      const onComplete = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress, onComplete);

      expect(downloadImageWithRetry).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Failed'));
      expect(onComplete).toHaveBeenCalledWith({
        completed: 0,
        failed: 1,
        skipped: 0
      });
    });

    test('should respect concurrency limits', async () => {
      jest.useFakeTimers();

      const images = Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/image${i}.jpg`
      }));

      let activeCalls = 0;
      let maxActiveCalls = 0;

      downloadImageWithRetry.mockImplementation(() => {
        activeCalls++;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        return new Promise(resolve => {
          setTimeout(() => {
            activeCalls--;
            resolve();
          }, 100);
        });
      });

      const downloadPromise = downloader.downloadImages(images, '/test/dir');

      // Advance timers in controlled steps to simulate concurrent execution
      for (let i = 0; i < 15; i++) {
        await Promise.resolve(); // Allow microtasks to run
        jest.advanceTimersByTime(50);
      }

      await downloadPromise;

      expect(maxActiveCalls).toBeLessThanOrEqual(3); // Should not exceed concurrent limit

      jest.useRealTimers();
    });

    test('should handle string URLs', async () => {
      const images = ['https://example.com/image1.jpg'];
      
      downloadImageWithRetry.mockResolvedValue();
      
      const onComplete = jest.fn();
      
      await downloader.downloadImages(images, '/test/dir', null, onComplete);
      
      expect(downloadImageWithRetry).toHaveBeenCalledWith(
        'https://example.com/image1.jpg',
        expect.stringContaining('image_0.jpg'),
        expect.any(Function),
        null // thumbnail URL
      );
    });

    test('should add delay between downloads', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];
      
      downloadImageWithRetry.mockResolvedValue();
      
      await downloader.downloadImages(images, '/test/dir');
      
      expect(delay).toHaveBeenCalledWith(200); // Image delay from config
    });
  });

  describe('semaphore management', () => {
    test('should acquire and release semaphore correctly', async () => {
      expect(downloader.activeSemaphore).toBe(0);
      
      await downloader.acquireSemaphore();
      expect(downloader.activeSemaphore).toBe(1);
      
      downloader.releaseSemaphore();
      expect(downloader.activeSemaphore).toBe(0);
    });

    test('should wait when semaphore is full', async () => {
      downloader.maxConcurrent = 1;
      downloader.activeSemaphore = 1; // Already at limit
      
      let acquired = false;
      const acquisitionPromise = downloader.acquireSemaphore().then(() => {
        acquired = true;
      });
      
      // Should not acquire immediately
      await Promise.resolve();
      expect(acquired).toBe(false);
      
      // Release semaphore
      downloader.releaseSemaphore();
      
      // Now should acquire
      await acquisitionPromise;
      expect(acquired).toBe(true);
    });
  });

  describe('updateMaxConcurrent', () => {
    test('should update concurrent limit', () => {
      downloader.updateMaxConcurrent(5);
      expect(downloader.maxConcurrent).toBe(5);
    });

    test('should enforce minimum limit of 1', () => {
      downloader.updateMaxConcurrent(0);
      expect(downloader.maxConcurrent).toBe(1);
      
      downloader.updateMaxConcurrent(-5);
      expect(downloader.maxConcurrent).toBe(1);
    });

    test('should enforce maximum limit of 20', () => {
      downloader.updateMaxConcurrent(25);
      expect(downloader.maxConcurrent).toBe(20);
    });
  });

  describe('getStatus', () => {
    test('should return current status', () => {
      downloader.activeSemaphore = 2;
      downloader.stats.completed = 5;
      
      const status = downloader.getStatus();
      
      expect(status).toEqual({
        activeTasks: 2,
        maxConcurrent: 3,
        stats: {
          completed: 5,
          failed: 0,
          skipped: 0
        }
      });
    });
  });

  describe('error handling', () => {
    test('should handle file stat errors gracefully', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];
      
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockRejectedValue(new Error('Stat error'));
      downloadImageWithRetry.mockResolvedValue();
      
      const onComplete = jest.fn();
      
      await downloader.downloadImages(images, '/test/dir', null, onComplete);
      
      // Should still try to download when stat fails
      expect(downloadImageWithRetry).toHaveBeenCalled();
    });

    test('should handle zero-size files', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];
      
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 0 });
      downloadImageWithRetry.mockResolvedValue();
      
      const onComplete = jest.fn();
      
      await downloader.downloadImages(images, '/test/dir', null, onComplete);
      
      // Should try to download zero-size files
      expect(downloadImageWithRetry).toHaveBeenCalled();
    });

    test('should handle general errors in executeDownload', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];
      
      // Mock getImageName to throw an error
      getImageName.mockImplementation(() => {
        throw new Error('Name generation error');
      });
      
      const onProgress = jest.fn();
      const onComplete = jest.fn();
      
      await downloader.downloadImages(images, '/test/dir', onProgress, onComplete);
      
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Error:'));
      expect(onComplete).toHaveBeenCalledWith({
        completed: 0,
        failed: 1,
        skipped: 0
      });
    });
  });

  describe('progress reporting', () => {
    test('should show verbose progress when enabled', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];

      downloadImageWithRetry.mockImplementation(async (url, path, onProgress) => {
        onProgress('Downloading file...');
      });

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Downloading file'));
    });

    test('should not show skipped files when disabled', async () => {
      const images = [{ url: 'https://example.com/image1.jpg' }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 1024 });
      config.shouldShowSkippedFiles.mockReturnValue(false);

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    });
  });

  describe('thumbnail upgrade logic', () => {
    test('should upgrade small file to full resolution when thumbnailUrl exists', async () => {
      const images = [{
        url: 'https://example.com/data/image1.jpg',
        thumbnailUrl: 'https://example.com/thumbnail/image1.jpg'
      }];

      // File exists but is small (likely thumbnail)
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValueOnce({ size: 100 * 1024 }); // 100KB - small file
      fs.stat.mockResolvedValueOnce({ size: 2 * 1024 * 1024 }); // 2MB - new file
      fs.move.mockResolvedValue();

      downloadImageWithRetry.mockResolvedValue();

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Checking for full resolution'));
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Upgraded'));
      expect(fs.move).toHaveBeenCalled();
    });

    test('should keep existing file if full resolution is not larger', async () => {
      const images = [{
        url: 'https://example.com/data/image1.jpg',
        thumbnailUrl: 'https://example.com/thumbnail/image1.jpg'
      }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValueOnce({ size: 100 * 1024 }); // 100KB - existing
      fs.stat.mockResolvedValueOnce({ size: 90 * 1024 }); // 90KB - new is smaller!
      fs.remove.mockResolvedValue();

      downloadImageWithRetry.mockResolvedValue();

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(fs.remove).toHaveBeenCalled(); // Remove temp file
      expect(fs.move).not.toHaveBeenCalled(); // Don't replace
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('already full resolution'));
    });

    test('should skip upgrade check for large files', async () => {
      const images = [{
        url: 'https://example.com/data/image1.jpg',
        thumbnailUrl: 'https://example.com/thumbnail/image1.jpg'
      }];

      // File exists and is already large (>500KB)
      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 600 * 1024 }); // 600KB - already full res

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(downloadImageWithRetry).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    });

    test('should skip upgrade if thumbnailUrl is same as url', async () => {
      const images = [{
        url: 'https://example.com/data/image1.jpg',
        thumbnailUrl: 'https://example.com/data/image1.jpg' // Same URL
      }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 100 * 1024 });

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(downloadImageWithRetry).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    });

    test('should handle upgrade download failure gracefully', async () => {
      const images = [{
        url: 'https://example.com/data/image1.jpg',
        thumbnailUrl: 'https://example.com/thumbnail/image1.jpg'
      }];

      fs.pathExists.mockResolvedValue(true);
      fs.stat.mockResolvedValue({ size: 100 * 1024 });

      downloadImageWithRetry.mockRejectedValue(new Error('404 Not Found'));

      const onProgress = jest.fn();

      await downloader.downloadImages(images, '/test/dir', onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('full resolution unavailable'));
    });
  });
});