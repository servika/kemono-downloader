const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const {
  PENDING_FULL_IMAGE_STATUS,
  loadPendingFiles,
  markPendingFullImage,
  clearPendingFullImage,
  countPendingInProfile
} = require('../../src/utils/pendingFullImages');
const { getDownloadStatus, isPostAlreadyDownloaded, verifyAllImagesDownloaded } = require('../../src/utils/downloadChecker');
const ProfileStateManager = require('../../src/utils/profileStateManager');
const { deriveThumbnailUrl } = require('../../src/utils/urlUtils');

const SOURCE = { url: 'https://n1.kemono.cr/data/aa/aa/a.jpg', previewUrl: 'https://img.kemono.cr/thumbnail/data/aa/aa/a.jpg' };

describe('pendingFullImages', () => {
  let root;
  let postDir;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pending-full-'));
    postDir = path.join(root, 'profile', 'post1');
    await fs.ensureDir(postDir);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  describe('manifest', () => {
    test('should return nothing when no manifest exists', async () => {
      expect(await loadPendingFiles(postDir)).toEqual({});
    });

    test('should store the status and the sources of a preview', async () => {
      await markPendingFullImage(postDir, 'a.jpg', SOURCE);

      const manifest = await fs.readJson(path.join(postDir, '.pending-full.json'));
      expect(manifest.status).toBe(PENDING_FULL_IMAGE_STATUS);
      expect(manifest.files['a.jpg']).toMatchObject(SOURCE);
    });

    test('should keep every entry when marking concurrently', async () => {
      const names = Array.from({ length: 20 }, (_, i) => `${i}.jpg`);

      await Promise.all(names.map(name => markPendingFullImage(postDir, name, SOURCE)));

      expect(Object.keys(await loadPendingFiles(postDir)).sort()).toEqual([...names].sort());
    });

    test('should remove the manifest with its last entry', async () => {
      await markPendingFullImage(postDir, 'a.jpg', SOURCE);
      await markPendingFullImage(postDir, 'b.jpg', SOURCE);

      await clearPendingFullImage(postDir, 'a.jpg');
      expect(Object.keys(await loadPendingFiles(postDir))).toEqual(['b.jpg']);

      await clearPendingFullImage(postDir, 'b.jpg');
      expect(await fs.pathExists(path.join(postDir, '.pending-full.json'))).toBe(false);
    });

    test('should treat a corrupt manifest as empty', async () => {
      await fs.writeFile(path.join(postDir, '.pending-full.json'), '{broken');

      expect(await loadPendingFiles(postDir)).toEqual({});
    });
  });

  describe('countPendingInProfile', () => {
    test('should count previews across posts', async () => {
      const otherPost = path.join(root, 'profile', 'post2');
      await fs.ensureDir(otherPost);
      await markPendingFullImage(postDir, 'a.jpg', SOURCE);
      await markPendingFullImage(postDir, 'b.jpg', SOURCE);
      await markPendingFullImage(otherPost, 'c.jpg', SOURCE);
      await fs.writeJson(path.join(root, 'profile', '.download-state.json'), { completed: false });

      expect(await countPendingInProfile(path.join(root, 'profile'))).toBe(3);
    });

    test('should return 0 for a missing folder', async () => {
      expect(await countPendingInProfile(path.join(root, 'missing'))).toBe(0);
    });
  });

  describe('download checks', () => {
    // A preview is JPEG even when the post lists a .png
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(0), 0xff, 0xd9]);

    beforeEach(async () => {
      await fs.writeFile(path.join(postDir, 'a.png'), JPEG);
      await fs.writeJson(path.join(postDir, 'post-metadata.json'), {});
      await markPendingFullImage(postDir, 'a.png', SOURCE);
    });

    test('should give the post the pending-full-image status', async () => {
      expect(await getDownloadStatus(postDir)).toBe(PENDING_FULL_IMAGE_STATUS);
    });

    test('should not treat the post as downloaded', async () => {
      const result = await isPostAlreadyDownloaded(postDir, null);

      expect(result.downloaded).toBe(false);
      expect(result.reason).toContain(PENDING_FULL_IMAGE_STATUS);
    });

    test('should not report a preview as corrupted', async () => {
      const result = await verifyAllImagesDownloaded(postDir, [{ url: SOURCE.url, filename: 'a.png' }]);

      expect(result.corruptedFiles).toEqual([]);
      expect(result.allPresent).toBe(true);
    });

    test('should return to the normal status once cleared', async () => {
      await clearPendingFullImage(postDir, 'a.png');

      expect(await getDownloadStatus(postDir)).toBe('completed');
    });
  });

  describe('ProfileStateManager.markIncomplete', () => {
    test('should record the pending status on the profile', async () => {
      const manager = new ProfileStateManager(root);

      await manager.markIncomplete('profile', { profileUrl: 'https://kemono.cr/patreon/user/1', totalPosts: 2, pendingFullImages: 3 });

      const state = await manager.getProfileState('profile');
      expect(state).toMatchObject({ completed: false, status: PENDING_FULL_IMAGE_STATUS, pendingFullImages: 3 });
      expect(await manager.isProfileCompleted('profile')).toBe(false);
    });

    test('should not use the pending status when no previews are left', async () => {
      const manager = new ProfileStateManager(root);

      await manager.markIncomplete('profile', { pendingFullImages: 0 });

      expect((await manager.getProfileState('profile')).status).toBe('in-progress');
    });
  });

  describe('deriveThumbnailUrl', () => {
    const HASH = 'a'.repeat(64);

    test.each(['n1.kemono.cr', 'kemono.cr'])('should build the thumbnail URL for %s', (host) => {
      expect(deriveThumbnailUrl(`https://${host}/data/aa/aa/${HASH}.png?f=art.png`))
        .toBe(`https://img.kemono.cr/thumbnail/data/aa/aa/${HASH}.png`);
    });

    test.each([
      ['video', `https://n1.kemono.cr/data/aa/aa/${HASH}.mp4`],
      ['archive', `https://n1.kemono.cr/data/aa/aa/${HASH}.zip`],
      ['another site', `https://example.com/data/aa/aa/${HASH}.png`],
      ['look-alike host', `https://evilkemono.cr/data/aa/aa/${HASH}.png`],
      ['thumbnail path', `https://img.kemono.cr/thumbnail/data/aa/aa/${HASH}.png`],
      ['bad URL', 'not a url']
    ])('should return null for %s', (_, url) => {
      expect(deriveThumbnailUrl(url)).toBeNull();
    });
  });
});
