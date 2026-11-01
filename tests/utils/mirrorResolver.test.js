const axios = require('axios');
const config = require('../../src/utils/config');
const { delay } = require('../../src/utils/delay');
const {
  MIRROR_USER_AGENT,
  isMirrorUrl,
  withMirrorSlot,
  reportMirrorFailure,
  resolveMirrorUrl,
  resetMirrorState
} = require('../../src/utils/mirrorResolver');

jest.mock('axios');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/delay');

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const KEMONO_POST = 'https://kemono.cr/patreon/user/123/post/456';
const KEMONO_FILE = `https://n1.kemono.cr/data/aa/aa/${HASH}.png?f=art.png`;
const mirrorFile = (hash = HASH, host = 'n2.pawchive.pw') => `https://${host}/data/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png`;

describe('mirrorResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMirrorState();
    config.getMirrors.mockReturnValue(['https://pawchive.pw', 'https://pawchive.st']);
    config.getTimeout.mockReturnValue(1000);
    delay.mockImplementation(() => new Promise(resolve => setImmediate(resolve)));
  });

  describe('isMirrorUrl', () => {
    test('should match mirrors and their subdomains only', () => {
      expect(isMirrorUrl('https://pawchive.pw/x')).toBe(true);
      expect(isMirrorUrl('https://n2.pawchive.pw/data/x.png')).toBe(true);
      expect(isMirrorUrl('https://kemono.cr/x')).toBe(false);
      expect(isMirrorUrl('https://evilpawchive.pw/x')).toBe(false);
      expect(isMirrorUrl('https://pawchive.pw.evil.com/x')).toBe(false);
      expect(isMirrorUrl('not a url')).toBe(false);
    });

    test('should ignore malformed and missing mirror config', () => {
      config.getMirrors.mockReturnValue(['not a url']);
      expect(isMirrorUrl('https://pawchive.pw/x')).toBe(false);
      config.getMirrors.mockReturnValue(undefined);
      expect(isMirrorUrl('https://pawchive.pw/x')).toBe(false);
    });
  });

  describe('resolveMirrorUrl', () => {
    test('should find the same file via the same post link and hash', async () => {
      axios.get.mockResolvedValue({ data: `<a class="fileThumb" href="${mirrorFile()}?f=art.png&amp;x=1">` });

      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBe(`${mirrorFile()}?f=art.png&x=1`);
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get.mock.calls[0][0]).toBe('https://pawchive.pw/patreon/user/123/post/456');
    });

    test('should identify itself and send no cookies', async () => {
      axios.get.mockResolvedValue({ data: '' });

      await resolveMirrorUrl(KEMONO_FILE, KEMONO_POST);

      const { headers } = axios.get.mock.calls[0][1];
      expect(headers).toEqual({ 'User-Agent': MIRROR_USER_AGENT });
      expect(MIRROR_USER_AGENT).toMatch(/^kemono-downloader\/\d/);
    });

    test('should return null when the mirror has a different file', async () => {
      axios.get.mockResolvedValue({ data: `<a href="${mirrorFile(OTHER_HASH)}">` });
      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBeNull();
    });

    test('should not accept thumbnails as the full file', async () => {
      axios.get.mockResolvedValue({ data: `<img src="https://img.pawchive.pw/thumbnail/data/aa/aa/${HASH}.png">` });
      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBeNull();
    });

    test('should reject links hosted outside configured mirrors', async () => {
      axios.get.mockResolvedValue({ data: `<a href="${mirrorFile(HASH, 'evil.example.com')}">` });
      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBeNull();
    });

    test('should try the next mirror when the post is missing', async () => {
      const notFound = Object.assign(new Error('nf'), { response: { status: 404 } });
      axios.get.mockRejectedValueOnce(notFound).mockResolvedValueOnce({ data: `<a href="${mirrorFile()}">` });

      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBe(mirrorFile());
      expect(axios.get.mock.calls[1][0]).toBe('https://pawchive.st/patreon/user/123/post/456');
    });

    test('should look a post up only once for several files', async () => {
      const secondFile = `https://n1.kemono.cr/data/bb/bb/${OTHER_HASH}.png`;
      axios.get.mockResolvedValue({ data: `<a href="${mirrorFile()}"><a href="${mirrorFile(OTHER_HASH)}">` });

      const [first, second] = await Promise.all([
        resolveMirrorUrl(KEMONO_FILE, KEMONO_POST),
        resolveMirrorUrl(secondFile, KEMONO_POST)
      ]);

      expect(first).toBe(mirrorFile());
      expect(second).toBe(mirrorFile(OTHER_HASH));
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('should not look up anything it cannot match', async () => {
      await expect(resolveMirrorUrl('https://n1.kemono.cr/data/art.png', KEMONO_POST)).resolves.toBeNull();
      await expect(resolveMirrorUrl(KEMONO_FILE, 'https://kemono.cr/patreon/user/123')).resolves.toBeNull();
      await expect(resolveMirrorUrl(mirrorFile(), KEMONO_POST)).resolves.toBeNull();
      await expect(resolveMirrorUrl('nonsense', KEMONO_POST)).resolves.toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('should do nothing when mirrors are disabled', async () => {
      config.getMirrors.mockReturnValue([]);
      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST)).resolves.toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    test.each([403, 429])('should stop using mirrors after a %i', async (status) => {
      const onProgress = jest.fn();
      axios.get.mockRejectedValue(Object.assign(new Error('refused'), { response: { status } }));

      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST, onProgress)).resolves.toBeNull();
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('not using mirrors'));

      await expect(resolveMirrorUrl(KEMONO_FILE, 'https://kemono.cr/patreon/user/9/post/9')).resolves.toBeNull();
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('should keep mirrors enabled after a network error', async () => {
      const onProgress = jest.fn();
      axios.get.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ data: `<a href="${mirrorFile()}">` });

      await expect(resolveMirrorUrl(KEMONO_FILE, KEMONO_POST, onProgress)).resolves.toBe(mirrorFile());
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    });
  });

  describe('reportMirrorFailure', () => {
    test('should work without a progress callback', () => {
      expect(() => reportMirrorFailure(new Error('x'))).not.toThrow();
      expect(() => reportMirrorFailure(Object.assign(new Error('x'), { response: { status: 403 } }))).not.toThrow();
    });
  });

  describe('withMirrorSlot', () => {
    test('should space requests at least one second apart', async () => {
      await withMirrorSlot(async () => {});
      await withMirrorSlot(async () => {});
      await withMirrorSlot(async () => {});

      const waits = delay.mock.calls.map(([ms]) => ms);
      expect(waits).toHaveLength(2);
      expect(waits[0]).toBeGreaterThan(900);
      expect(waits[1]).toBeGreaterThan(1900);
    });

    test('should allow at most 5 active requests', async () => {
      const releases = [];
      let peak = 0;
      let active = 0;
      const request = () => new Promise(resolve => {
        active++;
        peak = Math.max(peak, active);
        releases.push(() => { active--; resolve(); });
      });

      const all = Promise.all(Array.from({ length: 7 }, () => withMirrorSlot(request)));
      while (releases.length < 5) await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
      expect(active).toBe(5);

      while (releases.length) {
        releases.shift()();
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
      }
      await all;
      expect(peak).toBe(5);
    });

    test('should release the slot when a request fails', async () => {
      await expect(withMirrorSlot(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      await expect(withMirrorSlot(async () => 'ok')).resolves.toBe('ok');
    });
  });
});
