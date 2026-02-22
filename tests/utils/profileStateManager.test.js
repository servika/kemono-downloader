const fs = require('fs-extra');
const path = require('path');
const ProfileStateManager = require('../../src/utils/profileStateManager');

jest.mock('fs-extra');

describe('ProfileStateManager', () => {
  let manager;
  const baseDownloadDir = '/test/downloads';
  const testUsername = 'test-user';

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ProfileStateManager(baseDownloadDir);
    // Mock console to avoid noise in test output
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with base download directory', () => {
      expect(manager.baseDownloadDir).toBe(baseDownloadDir);
    });
  });

  describe('getStateFilePath', () => {
    it('should return correct state file path', () => {
      const expected = path.join(baseDownloadDir, testUsername, '.download-state.json');
      expect(manager.getStateFilePath(testUsername)).toBe(expected);
    });

    it('should handle different usernames', () => {
      const username = 'another-user';
      const expected = path.join(baseDownloadDir, username, '.download-state.json');
      expect(manager.getStateFilePath(username)).toBe(expected);
    });

    it('should handle usernames with special characters', () => {
      const username = 'user@123-test';
      const expected = path.join(baseDownloadDir, username, '.download-state.json');
      expect(manager.getStateFilePath(username)).toBe(expected);
    });
  });

  describe('isProfileCompleted', () => {
    it('should return false if state file does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);
      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(false);
    });

    it('should return true if profile is marked as completed', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ completed: true });

      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(true);
    });

    it('should return false if profile is not completed', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ completed: false });

      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(false);
    });

    it('should return false if state file is corrupted', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockRejectedValue(new Error('Invalid JSON'));

      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(false);
    });

    it('should return false if completed field is missing', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ someOtherField: 'value' });

      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(false);
    });

    it('should return false on read error', async () => {
      fs.pathExists.mockRejectedValue(new Error('Permission denied'));

      const result = await manager.isProfileCompleted(testUsername);
      expect(result).toBe(false);
    });
  });

  describe('getProfileState', () => {
    it('should return null if state file does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      const result = await manager.getProfileState(testUsername);
      expect(result).toBeNull();
    });

    it('should return state object if file exists', async () => {
      const mockState = {
        completed: true,
        completedAt: '2026-01-05T10:00:00.000Z',
        profileUrl: 'https://kemono.cr/patreon/user/123',
        service: 'patreon',
        userId: '123',
        totalPosts: 50,
        totalImages: 200,
        totalErrors: 2,
        version: '1.0.0'
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockState);

      const result = await manager.getProfileState(testUsername);
      expect(result).toEqual(mockState);
    });

    it('should return null if state file is corrupted', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockRejectedValue(new Error('Invalid JSON'));

      const result = await manager.getProfileState(testUsername);
      expect(result).toBeNull();
    });

    it('should return null on read error', async () => {
      fs.pathExists.mockRejectedValue(new Error('Permission denied'));

      const result = await manager.getProfileState(testUsername);
      expect(result).toBeNull();
    });
  });

  describe('markCompleted', () => {
    const metadata = {
      profileUrl: 'https://kemono.cr/patreon/user/123',
      service: 'patreon',
      userId: '123',
      totalPosts: 50,
      totalImages: 200,
      totalErrors: 2
    };

    beforeEach(() => {
      fs.ensureDir.mockResolvedValue();
      fs.writeJson.mockResolvedValue();
    });

    it('should create profile directory and save state', async () => {
      await manager.markCompleted(testUsername, metadata);

      const profileDir = path.join(baseDownloadDir, testUsername);
      expect(fs.ensureDir).toHaveBeenCalledWith(profileDir);
      expect(fs.writeJson).toHaveBeenCalled();
    });

    it('should save complete state with all metadata', async () => {
      await manager.markCompleted(testUsername, metadata);

      const stateFile = path.join(baseDownloadDir, testUsername, '.download-state.json');
      const savedState = fs.writeJson.mock.calls[0][1];

      expect(savedState.completed).toBe(true);
      expect(savedState.profileUrl).toBe(metadata.profileUrl);
      expect(savedState.service).toBe(metadata.service);
      expect(savedState.userId).toBe(metadata.userId);
      expect(savedState.totalPosts).toBe(metadata.totalPosts);
      expect(savedState.totalImages).toBe(metadata.totalImages);
      expect(savedState.totalErrors).toBe(metadata.totalErrors);
      expect(savedState.version).toBe('1.0.0');
      expect(savedState.completedAt).toBeDefined();
    });

    it('should use default values for missing metadata fields', async () => {
      await manager.markCompleted(testUsername, {});

      const savedState = fs.writeJson.mock.calls[0][1];
      expect(savedState.profileUrl).toBe('');
      expect(savedState.service).toBe('');
      expect(savedState.userId).toBe('');
      expect(savedState.totalPosts).toBe(0);
      expect(savedState.totalImages).toBe(0);
      expect(savedState.totalErrors).toBe(0);
    });

    it('should format JSON with 2 spaces', async () => {
      await manager.markCompleted(testUsername, metadata);

      const options = fs.writeJson.mock.calls[0][2];
      expect(options.spaces).toBe(2);
    });

    it('should log success message', async () => {
      await manager.markCompleted(testUsername, metadata);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('💾 Saved completion state')
      );
    });

    it('should handle write errors gracefully', async () => {
      fs.writeJson.mockRejectedValue(new Error('Write failed'));

      await manager.markCompleted(testUsername, metadata);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save completion state')
      );
    });

    it('should handle directory creation errors gracefully', async () => {
      fs.ensureDir.mockRejectedValue(new Error('Permission denied'));

      await manager.markCompleted(testUsername, metadata);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save completion state')
      );
    });
  });

  describe('updateProgress', () => {
    const progress = {
      downloadedPosts: 25,
      totalPosts: 50,
      downloadedImages: 100
    };

    beforeEach(() => {
      fs.ensureDir.mockResolvedValue();
      fs.writeJson.mockResolvedValue();
    });

    it('should create new state file if not exists', async () => {
      fs.pathExists.mockResolvedValue(false);

      await manager.updateProgress(testUsername, progress);

      const savedState = fs.writeJson.mock.calls[0][1];
      expect(savedState.completed).toBe(false);
      expect(savedState.downloadedPosts).toBe(progress.downloadedPosts);
      expect(savedState.totalPosts).toBe(progress.totalPosts);
      expect(savedState.downloadedImages).toBe(progress.downloadedImages);
    });

    it('should update existing state file', async () => {
      const existingState = {
        completed: true,
        profileUrl: 'https://kemono.cr/patreon/user/123'
      };

      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(existingState);

      await manager.updateProgress(testUsername, progress);

      const savedState = fs.writeJson.mock.calls[0][1];
      expect(savedState.completed).toBe(false); // Should be overridden
      expect(savedState.profileUrl).toBe(existingState.profileUrl); // Preserved
      expect(savedState.downloadedPosts).toBe(progress.downloadedPosts);
    });

    it('should set lastUpdatedAt timestamp', async () => {
      fs.pathExists.mockResolvedValue(false);

      await manager.updateProgress(testUsername, progress);

      const savedState = fs.writeJson.mock.calls[0][1];
      expect(savedState.lastUpdatedAt).toBeDefined();
    });

    it('should use default values for missing progress fields', async () => {
      fs.pathExists.mockResolvedValue(false);

      await manager.updateProgress(testUsername, {});

      const savedState = fs.writeJson.mock.calls[0][1];
      expect(savedState.downloadedPosts).toBe(0);
      expect(savedState.totalPosts).toBe(0);
      expect(savedState.downloadedImages).toBe(0);
    });

    it('should handle write errors gracefully', async () => {
      fs.pathExists.mockResolvedValue(false);
      fs.writeJson.mockRejectedValue(new Error('Write failed'));

      await manager.updateProgress(testUsername, progress);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update progress')
      );
    });

    it('should handle directory creation errors gracefully', async () => {
      fs.ensureDir.mockRejectedValue(new Error('Permission denied'));

      await manager.updateProgress(testUsername, progress);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update progress')
      );
    });

    it('should handle corrupted existing state file', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockRejectedValue(new Error('Invalid JSON'));

      await manager.updateProgress(testUsername, progress);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update progress')
      );
    });
  });

  describe('resetProfile', () => {
    it('should remove state file if it exists', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockResolvedValue();

      await manager.resetProfile(testUsername);

      const stateFile = path.join(baseDownloadDir, testUsername, '.download-state.json');
      expect(fs.remove).toHaveBeenCalledWith(stateFile);
    });

    it('should log success message when file is removed', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockResolvedValue();

      await manager.resetProfile(testUsername);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('🔄 Reset completion state')
      );
    });

    it('should do nothing if state file does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      await manager.resetProfile(testUsername);

      expect(fs.remove).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should handle removal errors gracefully', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockRejectedValue(new Error('Permission denied'));

      await manager.resetProfile(testUsername);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reset state')
      );
    });

    it('should handle pathExists errors gracefully', async () => {
      fs.pathExists.mockRejectedValue(new Error('Read error'));

      await manager.resetProfile(testUsername);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reset state')
      );
    });
  });

  describe('getStatistics', () => {
    it('should return empty stats if base directory does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      const stats = await manager.getStatistics();

      expect(stats).toEqual({
        totalProfiles: 0,
        completedProfiles: 0,
        inProgressProfiles: 0,
        totalPosts: 0,
        totalImages: 0,
        totalErrors: 0
      });
    });

    it('should return empty stats if no profile directories', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([]);

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(0);
    });

    it('should count completed profiles correctly', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: 'user2', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true, totalPosts: 50, totalImages: 200, totalErrors: 2 })
        .mockResolvedValueOnce({ completed: true, totalPosts: 30, totalImages: 100, totalErrors: 1 });

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(2);
      expect(stats.completedProfiles).toBe(2);
      expect(stats.inProgressProfiles).toBe(0);
      expect(stats.totalPosts).toBe(80);
      expect(stats.totalImages).toBe(300);
      expect(stats.totalErrors).toBe(3);
    });

    it('should count in-progress profiles correctly', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: 'user2', isDirectory: () => true }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: false })
        .mockResolvedValueOnce({ completed: false });

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(2);
      expect(stats.completedProfiles).toBe(0);
      expect(stats.inProgressProfiles).toBe(2);
    });

    it('should skip profiles without state files', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: 'user2', isDirectory: () => true }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true, totalPosts: 50 })
        .mockResolvedValueOnce(null);

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(1);
    });

    it('should skip non-directory entries', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: '.DS_Store', isDirectory: () => false },
        { name: 'file.txt', isDirectory: () => false }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true, totalPosts: 50 });

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(1);
    });

    it('should handle missing metadata fields gracefully', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true }); // No totalPosts, totalImages, totalErrors

      const stats = await manager.getStatistics();

      expect(stats.totalPosts).toBe(0);
      expect(stats.totalImages).toBe(0);
      expect(stats.totalErrors).toBe(0);
    });

    it('should return empty stats on error', async () => {
      fs.pathExists.mockRejectedValue(new Error('Read error'));

      const stats = await manager.getStatistics();

      expect(stats).toEqual({
        totalProfiles: 0,
        completedProfiles: 0,
        inProgressProfiles: 0,
        totalPosts: 0,
        totalImages: 0,
        totalErrors: 0
      });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get statistics')
      );
    });

    it('should handle readdir errors gracefully', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      const stats = await manager.getStatistics();

      expect(stats.totalProfiles).toBe(0);
    });
  });

  describe('listCompletedProfiles', () => {
    it('should return empty array if base directory does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      const result = await manager.listCompletedProfiles();

      expect(result).toEqual([]);
    });

    it('should return only completed profiles', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: 'user2', isDirectory: () => true },
        { name: 'user3', isDirectory: () => true }
      ]);

      const completedState = {
        completed: true,
        completedAt: '2026-01-05T10:00:00.000Z',
        totalPosts: 50
      };

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce(completedState)
        .mockResolvedValueOnce({ completed: false })
        .mockResolvedValueOnce(null);

      const result = await manager.listCompletedProfiles();

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('user1');
      expect(result[0].completed).toBe(true);
      expect(result[0].totalPosts).toBe(50);
    });

    it('should include username in profile info', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'test-user', isDirectory: () => true }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({
          completed: true,
          profileUrl: 'https://kemono.cr/patreon/user/123'
        });

      const result = await manager.listCompletedProfiles();

      expect(result[0]).toHaveProperty('username', 'test-user');
      expect(result[0]).toHaveProperty('profileUrl', 'https://kemono.cr/patreon/user/123');
    });

    it('should skip non-directory entries', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: '.DS_Store', isDirectory: () => false }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true });

      const result = await manager.listCompletedProfiles();

      expect(result).toHaveLength(1);
    });

    it('should return empty array on error', async () => {
      fs.pathExists.mockRejectedValue(new Error('Read error'));

      const result = await manager.listCompletedProfiles();

      expect(result).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list completed profiles')
      );
    });

    it('should handle readdir errors gracefully', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      const result = await manager.listCompletedProfiles();

      expect(result).toEqual([]);
    });

    it('should return multiple completed profiles in order', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'user1', isDirectory: () => true },
        { name: 'user2', isDirectory: () => true },
        { name: 'user3', isDirectory: () => true }
      ]);

      jest.spyOn(manager, 'getProfileState')
        .mockResolvedValueOnce({ completed: true, totalPosts: 10 })
        .mockResolvedValueOnce({ completed: true, totalPosts: 20 })
        .mockResolvedValueOnce({ completed: true, totalPosts: 30 });

      const result = await manager.listCompletedProfiles();

      expect(result).toHaveLength(3);
      expect(result[0].username).toBe('user1');
      expect(result[1].username).toBe('user2');
      expect(result[2].username).toBe('user3');
    });
  });
});