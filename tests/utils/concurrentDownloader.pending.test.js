const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const ConcurrentDownloader = require('../../src/utils/concurrentDownloader');
const { downloadImageWithRetry } = require('../../src/utils/fileUtils');
const config = require('../../src/utils/config');
const { loadPendingFiles, markPendingFullImage } = require('../../src/utils/pendingFullImages');

jest.mock('../../src/utils/fileUtils');
jest.mock('../../src/utils/delay');
jest.mock('../../src/utils/config');

const HASH = 'a'.repeat(64);
const FULL_URL = `https://n1.kemono.cr/data/aa/aa/${HASH}.jpg`;
const THUMB_URL = `https://img.kemono.cr/thumbnail/data/aa/aa/${HASH}.jpg`;
const IMAGE = { url: FULL_URL, filename: 'a.jpg' };
const POST = { postUrl: 'https://kemono.cr/patreon/user/1/post/2' };

describe('ConcurrentDownloader pending-full-image', () => {
  let postDir;
  let downloader;
  let onProgress;

  beforeEach(async () => {
    jest.clearAllMocks();
    config.getMaxConcurrentImages.mockReturnValue(3);
    config.getImageDelay.mockReturnValue(0);
    config.shouldShowSkippedFiles.mockReturnValue(true);
    config.shouldShowVerboseProgress.mockReturnValue(false);
    config.shouldShowDetailedErrors.mockReturnValue(true);
    postDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pending-post-'));
    downloader = new ConcurrentDownloader();
    onProgress = jest.fn();
  });

  afterEach(async () => {
    await fs.remove(postDir);
  });

  test('should derive the thumbnail when the post page gives none', async () => {
    downloadImageWithRetry.mockResolvedValue({ filepath: path.join(postDir, 'a.jpg') });

    await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

    expect(downloadImageWithRetry).toHaveBeenCalledWith(FULL_URL, path.join(postDir, 'a.jpg'), expect.any(Function), THUMB_URL, POST);
  });

  test('should mark a preview as pending and not count it as downloaded', async () => {
    downloadImageWithRetry.mockResolvedValue({ filepath: path.join(postDir, 'a.jpg'), isPreview: true });

    const stats = await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

    expect(stats).toEqual({ completed: 0, failed: 0, skipped: 0, pendingFull: 1 });
    expect((await loadPendingFiles(postDir))['a.jpg']).toMatchObject({ url: FULL_URL, previewUrl: THUMB_URL });
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('pending-full-image'));
  });

  describe('with a saved preview', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(postDir, 'a.jpg'), 'preview');
      await markPendingFullImage(postDir, 'a.jpg', { url: FULL_URL, previewUrl: THUMB_URL });
    });

    test('should replace it once the full image downloads, whatever its size', async () => {
      downloadImageWithRetry.mockImplementation(async (url, filepath) => {
        await fs.writeFile(filepath, 'full');
        return { filepath };
      });

      const stats = await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

      expect(stats).toEqual({ completed: 1, failed: 0, skipped: 0, pendingFull: 0 });
      expect(await fs.readFile(path.join(postDir, 'a.jpg'), 'utf8')).toBe('full');
      expect(await loadPendingFiles(postDir)).toEqual({});
      expect(await fs.pathExists(path.join(postDir, 'a.jpg.tmp'))).toBe(false);
    });

    test('should retry without a preview fallback', async () => {
      downloadImageWithRetry.mockRejectedValue(new Error('down'));

      await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

      expect(downloadImageWithRetry).toHaveBeenCalledWith(FULL_URL, path.join(postDir, 'a.jpg.tmp'), expect.any(Function), null, POST);
    });

    test('should keep the preview and the status when the full image stays unavailable', async () => {
      downloadImageWithRetry.mockImplementation(async (url, filepath) => {
        await fs.writeFile(filepath, 'partial');
        throw new Error('Server unreachable: n1.kemono.cr');
      });

      const stats = await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

      expect(stats).toEqual({ completed: 0, failed: 0, skipped: 0, pendingFull: 1 });
      expect(await fs.readFile(path.join(postDir, 'a.jpg'), 'utf8')).toBe('preview');
      expect(await fs.pathExists(path.join(postDir, 'a.jpg.tmp'))).toBe(false);
      expect((await loadPendingFiles(postDir))['a.jpg']).toBeDefined();
    });

    test('should download again and clear the status when the file was deleted', async () => {
      await fs.remove(path.join(postDir, 'a.jpg'));
      downloadImageWithRetry.mockResolvedValue({ filepath: path.join(postDir, 'a.jpg') });

      const stats = await downloader.downloadImages([IMAGE], postDir, onProgress, null, POST);

      expect(stats.completed).toBe(1);
      expect(await loadPendingFiles(postDir)).toEqual({});
    });
  });
});
