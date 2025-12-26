const fs = require('fs-extra');
const path = require('path');
const config = require('../../src/utils/config');

jest.mock('fs-extra');

describe('Config', () => {
  const originalCwd = process.cwd;
  beforeEach(() => {
    jest.clearAllMocks();
    process.cwd = jest.fn(() => '/test');
    config.configPath = path.join(process.cwd(), 'config.json');
    
    // Reset config to default state
    config.config = {
      download: {
        maxConcurrentImages: 3,
        maxConcurrentPosts: 1,
        delayBetweenImages: 200,
        delayBetweenPosts: 500,
        delayBetweenAPIRequests: 200,
        delayBetweenPages: 1000,
        retryAttempts: 3,
        retryDelay: 1000
      },
      api: {
        timeout: 30000,
        userAgent: "Mozilla/5.0 (compatible; kemono-downloader)"
      },
      storage: {
        baseDirectory: "download",
        createSubfolders: true,
        sanitizeFilenames: true,
        preserveOriginalNames: true
      },
      logging: {
        verboseProgress: true,
        showSkippedFiles: true,
        showDetailedErrors: true
      }
    };
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('load', () => {
    test('should load existing config file', async () => {
      const mockConfig = {
        download: { maxConcurrentImages: 5 }
      };
      
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(mockConfig);
      
      await config.load();
      
      expect(fs.pathExists).toHaveBeenCalledWith(config.configPath);
      expect(fs.readJson).toHaveBeenCalledWith(config.configPath);
      expect(config.getMaxConcurrentImages()).toBe(5);
    });

    test('should create default config if none exists', async () => {
      fs.pathExists.mockResolvedValue(false);
      fs.writeJson.mockResolvedValue();
      
      await config.load();
      
      expect(fs.pathExists).toHaveBeenCalledWith(config.configPath);
      expect(fs.writeJson).toHaveBeenCalledWith(config.configPath, expect.any(Object), { spaces: 2 });
    });

    test('should handle config loading errors', async () => {
      fs.pathExists.mockRejectedValue(new Error('File system error'));
      
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await config.load();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load config'));
      consoleSpy.mockRestore();
    });
  });

  describe('save', () => {
    test('should save config to file', async () => {
      fs.writeJson.mockResolvedValue();
      
      await config.save();
      
      expect(fs.writeJson).toHaveBeenCalledWith(config.configPath, config.config, { spaces: 2 });
    });

    test('should handle save errors', async () => {
      fs.writeJson.mockRejectedValue(new Error('Write error'));
      
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await config.save();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to save config'));
      consoleSpy.mockRestore();
    });
  });

  describe('get', () => {
    test('should get nested config values', () => {
      expect(config.get('download.maxConcurrentImages')).toBe(3);
      expect(config.get('api.timeout')).toBe(30000);
      expect(config.get('storage.baseDirectory')).toBe('download');
    });

    test('should return undefined for non-existent paths', () => {
      expect(config.get('nonexistent')).toBeUndefined();
      expect(config.get('download.nonexistent')).toBeUndefined();
    });
  });

  describe('set', () => {
    test('should set nested config values', () => {
      config.set('download.maxConcurrentImages', 10);
      expect(config.get('download.maxConcurrentImages')).toBe(10);
    });

    test('should create nested paths if they dont exist', () => {
      config.set('new.nested.value', 'test');
      expect(config.get('new.nested.value')).toBe('test');
    });
  });

  describe('convenience getters', () => {
    test('should return correct values from getters', () => {
      expect(config.getMaxConcurrentImages()).toBe(3);
      expect(config.getMaxConcurrentPosts()).toBe(1);
      expect(config.getImageDelay()).toBe(200);
      expect(config.getPostDelay()).toBe(500);
      expect(config.getAPIDelay()).toBe(200);
      expect(config.getPageDelay()).toBe(1000);
      expect(config.getRetryAttempts()).toBe(3);
      expect(config.getRetryDelay()).toBe(1000);
      expect(config.getUserAgent()).toBe('Mozilla/5.0 (compatible; kemono-downloader)');
      expect(config.getBaseDirectory()).toBe('download');
    });

    test('should return defaults when values are missing', () => {
      config.config.download = {};
      
      expect(config.getMaxConcurrentImages()).toBe(3);
      expect(config.getImageDelay()).toBe(200);
      expect(config.getBaseDirectory()).toBe('download');
    });

    test('should return boolean values for logging options', () => {
      expect(config.shouldShowVerboseProgress()).toBe(true);
      expect(config.shouldShowSkippedFiles()).toBe(true);
      expect(config.shouldShowDetailedErrors()).toBe(true);
      
      config.set('logging.verboseProgress', false);
      expect(config.shouldShowVerboseProgress()).toBe(false);
    });
  });

  describe('mergeConfig', () => {
    test('should merge nested objects correctly', () => {
      const defaultConfig = {
        download: { maxConcurrentImages: 3, retryAttempts: 3 },
        api: { timeout: 30000 }
      };
      
      const userConfig = {
        download: { maxConcurrentImages: 5 },
        storage: { baseDirectory: 'custom' }
      };
      
      const merged = config.mergeConfig(defaultConfig, userConfig);
      
      expect(merged.download.maxConcurrentImages).toBe(5);
      expect(merged.download.retryAttempts).toBe(3);
      expect(merged.api.timeout).toBe(30000);
      expect(merged.storage.baseDirectory).toBe('custom');
    });

    test('should handle non-object values', () => {
      const defaultConfig = { simple: 'default' };
      const userConfig = { simple: 'user' };
      
      const merged = config.mergeConfig(defaultConfig, userConfig);
      
      expect(merged.simple).toBe('user');
    });
  });
});
