const fs = require('fs-extra');
const path = require('path');
const DownloadState = require('../../src/utils/downloadState');

// Mock fs-extra
jest.mock('fs-extra');

describe('DownloadState', () => {
  let downloadState;
  const testStateFile = '/test/download-state.json';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fs operations
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockImplementation(() => {});

    downloadState = new DownloadState(testStateFile);
  });

  describe('constructor and initialization', () => {
    it('should create instance with default state file path', () => {
      const state = new DownloadState();
      expect(state.stateFilePath).toBe(path.join(process.cwd(), 'download-state.json'));
    });

    it('should create instance with custom state file path', () => {
      const state = new DownloadState(testStateFile);
      expect(state.stateFilePath).toBe(testStateFile);
    });

    it('should initialize with empty state when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      const state = new DownloadState(testStateFile);

      expect(state.state).toEqual({
        profiles: {},
        version: '1.0.0'
      });
    });

    it('should load existing state from file', () => {
      const existingState = {
        profiles: {
          'patreon:123': {
            service: 'patreon',
            userId: '123',
            totalPosts: 10,
            downloadedPosts: 5,
            completed: false
          }
        },
        version: '1.0.0'
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const state = new DownloadState(testStateFile);
      expect(state.state).toEqual(existingState);
    });

    it('should handle JSON parse errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const state = new DownloadState(testStateFile);

      expect(state.state).toEqual({
        profiles: {},
        version: '1.0.0'
      });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('saveState', () => {
    it('should save state to file', () => {
      downloadState.saveState();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        testStateFile,
        JSON.stringify(downloadState.state, null, 2),
        'utf8'
      );
    });

    it('should throw error if save fails', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      expect(() => downloadState.saveState()).toThrow('Write failed');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getProfileKey', () => {
    it('should generate correct profile key', () => {
      const key = downloadState.getProfileKey('patreon', '12345');
      expect(key).toBe('patreon:12345');
    });

    it('should handle different services', () => {
      expect(downloadState.getProfileKey('fanbox', '999')).toBe('fanbox:999');
      expect(downloadState.getProfileKey('discord', 'abc123')).toBe('discord:abc123');
    });
  });

  describe('isProfileCompleted', () => {
    it('should return false for non-existent profile', () => {
      expect(downloadState.isProfileCompleted('patreon', '123')).toBe(false);
    });

    it('should return true for completed profile', () => {
      downloadState.state.profiles['patreon:123'] = {
        completed: true
      };

      expect(downloadState.isProfileCompleted('patreon', '123')).toBe(true);
    });

    it('should return false for incomplete profile', () => {
      downloadState.state.profiles['patreon:123'] = {
        completed: false
      };

      expect(downloadState.isProfileCompleted('patreon', '123')).toBe(false);
    });
  });

  describe('getProfileProgress', () => {
    it('should return null for non-existent profile', () => {
      expect(downloadState.getProfileProgress('patreon', '123')).toBeNull();
    });

    it('should return profile data when it exists', () => {
      const profileData = {
        service: 'patreon',
        userId: '123',
        totalPosts: 10,
        downloadedPosts: 5,
        completed: false
      };

      downloadState.state.profiles['patreon:123'] = profileData;

      expect(downloadState.getProfileProgress('patreon', '123')).toEqual(profileData);
    });
  });

  describe('initializeProfile', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should initialize new profile', () => {
      downloadState.initializeProfile('patreon', '123', 50);

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile).toEqual({
        service: 'patreon',
        userId: '123',
        totalPosts: 50,
        downloadedPosts: 0,
        completed: false,
        startedAt: '2024-01-01T00:00:00.000Z',
        lastUpdatedAt: '2024-01-01T00:00:00.000Z'
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should preserve downloadedPosts when re-initializing existing profile', () => {
      downloadState.state.profiles['patreon:123'] = {
        service: 'patreon',
        userId: '123',
        totalPosts: 40,
        downloadedPosts: 20,
        completed: false,
        startedAt: '2023-12-01T00:00:00.000Z',
        lastUpdatedAt: '2023-12-01T00:00:00.000Z'
      };

      downloadState.initializeProfile('patreon', '123', 50);

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile.downloadedPosts).toBe(20);
      expect(profile.totalPosts).toBe(50);
      expect(profile.startedAt).toBe('2023-12-01T00:00:00.000Z');
    });
  });

  describe('updateProgress', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      downloadState.state.profiles['patreon:123'] = {
        service: 'patreon',
        userId: '123',
        totalPosts: 50,
        downloadedPosts: 0,
        completed: false,
        startedAt: '2024-01-01T00:00:00.000Z',
        lastUpdatedAt: '2024-01-01T00:00:00.000Z'
      };
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should update downloaded posts count', () => {
      downloadState.updateProgress('patreon', '123', 25);

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile.downloadedPosts).toBe(25);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should update lastUpdatedAt timestamp', () => {
      jest.setSystemTime(new Date('2024-01-02T00:00:00Z'));

      downloadState.updateProgress('patreon', '123', 10);

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile.lastUpdatedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should throw error if profile not initialized', () => {
      expect(() => {
        downloadState.updateProgress('patreon', '999', 10);
      }).toThrow('Profile patreon:999 not initialized');
    });
  });

  describe('markCompleted', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      downloadState.state.profiles['patreon:123'] = {
        service: 'patreon',
        userId: '123',
        totalPosts: 50,
        downloadedPosts: 50,
        completed: false,
        startedAt: '2024-01-01T00:00:00.000Z',
        lastUpdatedAt: '2024-01-01T00:00:00.000Z'
      };
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should mark profile as completed', () => {
      downloadState.markCompleted('patreon', '123');

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile.completed).toBe(true);
      expect(profile.completedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should update lastUpdatedAt when marking completed', () => {
      jest.setSystemTime(new Date('2024-01-05T00:00:00Z'));

      downloadState.markCompleted('patreon', '123');

      const profile = downloadState.state.profiles['patreon:123'];
      expect(profile.lastUpdatedAt).toBe('2024-01-05T00:00:00.000Z');
    });

    it('should throw error if profile not initialized', () => {
      expect(() => {
        downloadState.markCompleted('patreon', '999');
      }).toThrow('Profile patreon:999 not initialized');
    });
  });

  describe('resetProfile', () => {
    it('should remove profile from state', () => {
      downloadState.state.profiles['patreon:123'] = {
        service: 'patreon',
        userId: '123',
        completed: true
      };

      downloadState.resetProfile('patreon', '123');

      expect(downloadState.state.profiles['patreon:123']).toBeUndefined();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle non-existent profile gracefully', () => {
      expect(() => {
        downloadState.resetProfile('patreon', '999');
      }).not.toThrow();
    });
  });

  describe('getCompletedProfiles', () => {
    it('should return empty array when no profiles exist', () => {
      expect(downloadState.getCompletedProfiles()).toEqual([]);
    });

    it('should return only completed profiles', () => {
      downloadState.state.profiles = {
        'patreon:123': { completed: true },
        'patreon:456': { completed: false },
        'fanbox:789': { completed: true },
        'discord:abc': { completed: false }
      };

      const completed = downloadState.getCompletedProfiles();

      expect(completed).toHaveLength(2);
      expect(completed).toContain('patreon:123');
      expect(completed).toContain('fanbox:789');
      expect(completed).not.toContain('patreon:456');
      expect(completed).not.toContain('discord:abc');
    });
  });

  describe('getStatistics', () => {
    it('should return zero statistics for empty state', () => {
      const stats = downloadState.getStatistics();

      expect(stats).toEqual({
        total: 0,
        completed: 0,
        inProgress: 0,
        totalPosts: 0,
        downloadedPosts: 0
      });
    });

    it('should calculate correct statistics', () => {
      downloadState.state.profiles = {
        'patreon:123': {
          totalPosts: 50,
          downloadedPosts: 50,
          completed: true
        },
        'patreon:456': {
          totalPosts: 100,
          downloadedPosts: 30,
          completed: false
        },
        'fanbox:789': {
          totalPosts: 75,
          downloadedPosts: 75,
          completed: true
        },
        'discord:abc': {
          totalPosts: 25,
          downloadedPosts: 10,
          completed: false
        }
      };

      const stats = downloadState.getStatistics();

      expect(stats).toEqual({
        total: 4,
        completed: 2,
        inProgress: 2,
        totalPosts: 250,
        downloadedPosts: 165
      });
    });

    it('should handle missing totalPosts and downloadedPosts fields', () => {
      downloadState.state.profiles = {
        'patreon:123': {
          completed: true
        },
        'patreon:456': {
          totalPosts: 50,
          completed: false
        }
      };

      const stats = downloadState.getStatistics();

      expect(stats.totalPosts).toBe(50);
      expect(stats.downloadedPosts).toBe(0);
    });
  });

  describe('integration scenarios', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle complete download workflow', () => {
      // Initialize profile
      downloadState.initializeProfile('patreon', '123', 10);
      expect(downloadState.isProfileCompleted('patreon', '123')).toBe(false);

      // Update progress incrementally
      for (let i = 1; i <= 10; i++) {
        downloadState.updateProgress('patreon', '123', i);
        const progress = downloadState.getProfileProgress('patreon', '123');
        expect(progress.downloadedPosts).toBe(i);
      }

      // Mark as completed
      downloadState.markCompleted('patreon', '123');
      expect(downloadState.isProfileCompleted('patreon', '123')).toBe(true);

      // Verify statistics
      const stats = downloadState.getStatistics();
      expect(stats.completed).toBe(1);
      expect(stats.inProgress).toBe(0);
    });

    it('should handle resume scenario', () => {
      // Start download
      downloadState.initializeProfile('patreon', '123', 100);
      downloadState.updateProgress('patreon', '123', 50);

      // Simulate app restart - re-initialize
      downloadState.initializeProfile('patreon', '123', 100);

      // Progress should be preserved
      const progress = downloadState.getProfileProgress('patreon', '123');
      expect(progress.downloadedPosts).toBe(50);
    });

    it('should handle multiple profiles', () => {
      downloadState.initializeProfile('patreon', '123', 50);
      downloadState.initializeProfile('fanbox', '456', 75);
      downloadState.initializeProfile('discord', '789', 25);

      downloadState.updateProgress('patreon', '123', 50);
      downloadState.markCompleted('patreon', '123');

      downloadState.updateProgress('fanbox', '456', 30);

      const stats = downloadState.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.inProgress).toBe(2);
      expect(stats.downloadedPosts).toBe(80);
    });
  });
});