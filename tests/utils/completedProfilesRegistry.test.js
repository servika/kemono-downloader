const fs = require('fs-extra');
const path = require('path');
const CompletedProfilesRegistry = require('../../src/utils/completedProfilesRegistry');

jest.mock('fs-extra');

describe('CompletedProfilesRegistry', () => {
  const registryPath = '/test/download/completed-profiles.json';
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    registry = new CompletedProfilesRegistry(registryPath);
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  describe('constructor', () => {
    test('should set registryPath and initialize empty map', () => {
      expect(registry.registryPath).toBe(registryPath);
      expect(registry.profileMap.size).toBe(0);
    });
  });

  describe('load', () => {
    test('should initialize empty map when file does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      await registry.load();

      expect(registry.profileMap.size).toBe(0);
    });

    test('should load profiles from existing file', async () => {
      const data = {
        version: '1.0.0',
        profiles: [
          { profileUrl: 'https://kemono.cr/patreon/user/123', username: 'artist1', totalPosts: 10 },
          { profileUrl: 'https://kemono.cr/fanbox/user/456', username: 'artist2', totalPosts: 5 }
        ]
      };
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(data);

      await registry.load();

      expect(registry.profileMap.size).toBe(2);
      expect(registry.profileMap.has('https://kemono.cr/patreon/user/123')).toBe(true);
      expect(registry.profileMap.has('https://kemono.cr/fanbox/user/456')).toBe(true);
    });

    test('should handle empty profiles array', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ version: '1.0.0', profiles: [] });

      await registry.load();

      expect(registry.profileMap.size).toBe(0);
    });

    test('should handle missing profiles field', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ version: '1.0.0' });

      await registry.load();

      expect(registry.profileMap.size).toBe(0);
    });

    test('should skip entries without profileUrl', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        profiles: [
          { username: 'no-url-entry' },
          { profileUrl: 'https://kemono.cr/patreon/user/123', username: 'valid' }
        ]
      });

      await registry.load();

      expect(registry.profileMap.size).toBe(1);
    });

    test('should warn and initialize empty map on read error', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockRejectedValue(new Error('Corrupted JSON'));

      await registry.load();

      expect(registry.profileMap.size).toBe(0);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
    });
  });

  describe('isCompleted', () => {
    test('should return false for unknown URL', () => {
      expect(registry.isCompleted('https://kemono.cr/patreon/user/999')).toBe(false);
    });

    test('should return true for registered URL', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        profiles: [{ profileUrl: 'https://kemono.cr/patreon/user/123', username: 'artist1' }]
      });
      await registry.load();

      expect(registry.isCompleted('https://kemono.cr/patreon/user/123')).toBe(true);
    });

    test('should be synchronous after load', () => {
      registry.profileMap.set('https://kemono.cr/test/user/1', { profileUrl: 'https://kemono.cr/test/user/1' });

      expect(registry.isCompleted('https://kemono.cr/test/user/1')).toBe(true);
      expect(registry.isCompleted('https://kemono.cr/test/user/2')).toBe(false);
    });
  });

  describe('markCompleted', () => {
    const entry = {
      profileUrl: 'https://kemono.cr/patreon/user/123',
      username: 'artist1',
      service: 'patreon',
      userId: '123',
      totalPosts: 42,
      totalImages: 200
    };

    beforeEach(() => {
      fs.ensureDir.mockResolvedValue();
      fs.writeJson.mockResolvedValue();
      fs.rename.mockResolvedValue();
    });

    test('should add entry to profileMap', async () => {
      await registry.markCompleted(entry);

      expect(registry.isCompleted(entry.profileUrl)).toBe(true);
    });

    test('should add completedAt timestamp if not provided', async () => {
      await registry.markCompleted(entry);

      const saved = registry.profileMap.get(entry.profileUrl);
      expect(saved.completedAt).toBeDefined();
      expect(new Date(saved.completedAt).toISOString()).toBe(saved.completedAt);
    });

    test('should preserve provided completedAt', async () => {
      const withTimestamp = { ...entry, completedAt: '2026-01-01T00:00:00.000Z' };
      await registry.markCompleted(withTimestamp);

      const saved = registry.profileMap.get(entry.profileUrl);
      expect(saved.completedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    test('should write to temp file then rename atomically', async () => {
      await registry.markCompleted(entry);

      expect(fs.writeJson).toHaveBeenCalledWith(
        `${registryPath}.tmp`,
        expect.objectContaining({ version: '1.0.0', profiles: expect.any(Array) }),
        { spaces: 2 }
      );
      expect(fs.rename).toHaveBeenCalledWith(`${registryPath}.tmp`, registryPath);
    });

    test('should include all profiles in saved data', async () => {
      const entry2 = { ...entry, profileUrl: 'https://kemono.cr/fanbox/user/456', username: 'artist2' };
      await registry.markCompleted(entry);
      await registry.markCompleted(entry2);

      const savedData = fs.writeJson.mock.calls[fs.writeJson.mock.calls.length - 1][1];
      expect(savedData.profiles).toHaveLength(2);
    });

    test('should update existing entry on re-mark', async () => {
      await registry.markCompleted(entry);
      await registry.markCompleted({ ...entry, totalPosts: 99 });

      expect(registry.profileMap.size).toBe(1);
      expect(registry.profileMap.get(entry.profileUrl).totalPosts).toBe(99);
    });

    test('should warn but not throw on save error', async () => {
      fs.writeJson.mockRejectedValue(new Error('Disk full'));

      await expect(registry.markCompleted(entry)).resolves.not.toThrow();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to save'));
      // Entry is still in memory
      expect(registry.isCompleted(entry.profileUrl)).toBe(true);
    });
  });

  describe('getAll', () => {
    test('should return empty array when no profiles', async () => {
      const result = await registry.getAll();
      expect(result).toEqual([]);
    });

    test('should return all registered profiles', async () => {
      registry.profileMap.set('url1', { profileUrl: 'url1', username: 'a' });
      registry.profileMap.set('url2', { profileUrl: 'url2', username: 'b' });

      const result = await registry.getAll();
      expect(result).toHaveLength(2);
    });
  });
});
