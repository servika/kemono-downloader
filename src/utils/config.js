const fs = require('fs-extra');
const path = require('path');

/**
 * Configuration management utilities
 */

const DEFAULT_CONFIG = {
  download: {
    maxConcurrentImages: 3,
    maxConcurrentPosts: 1,
    delayBetweenImages: 200,
    delayBetweenPosts: 500,
    delayBetweenAPIRequests: 200,
    delayBetweenPages: 1000,
    retryAttempts: 3,
    retryDelay: 1000,
    forceRedownload: false
  },
  api: {
    baseUrl: "https://kemono.cr",
    timeout: 30000,
    userAgent: "Mozilla/5.0 (compatible; kemono-downloader)",
    cookies: {
      session: ""
    }
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

class Config {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.configPath = path.join(process.cwd(), 'config.json');
  }

  async load() {
    try {
      if (await fs.pathExists(this.configPath)) {
        const configData = await fs.readJson(this.configPath);
        this.config = this.mergeConfig(DEFAULT_CONFIG, configData);
        console.log('📋 Loaded configuration from config.json');
      } else {
        await this.save();
        console.log('📋 Created default config.json file');
      }
    } catch (error) {
      console.warn(`⚠️  Failed to load config: ${error.message}, using defaults`);
    }
  }

  async save() {
    try {
      await fs.writeJson(this.configPath, this.config, { spaces: 2 });
    } catch (error) {
      console.warn(`⚠️  Failed to save config: ${error.message}`);
    }
  }

  mergeConfig(defaultConfig, userConfig) {
    const merged = { ...defaultConfig };
    
    for (const [key, value] of Object.entries(userConfig)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        merged[key] = { ...defaultConfig[key], ...value };
      } else {
        merged[key] = value;
      }
    }
    
    return merged;
  }

  get(path) {
    const keys = path.split('.');
    let current = this.config;
    
    for (const key of keys) {
      if (current[key] === undefined) {
        return undefined;
      }
      current = current[key];
    }
    
    return current;
  }

  set(path, value) {
    const keys = path.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current[key] === undefined || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  // Convenience getters for common config values
  getMaxConcurrentImages() {
    return this.get('download.maxConcurrentImages') || 3;
  }

  getMaxConcurrentPosts() {
    return this.get('download.maxConcurrentPosts') || 1;
  }

  getImageDelay() {
    return this.get('download.delayBetweenImages') || 200;
  }

  getPostDelay() {
    return this.get('download.delayBetweenPosts') || 500;
  }

  getAPIDelay() {
    return this.get('download.delayBetweenAPIRequests') || 200;
  }

  getPageDelay() {
    return this.get('download.delayBetweenPages') || 1000;
  }

  getRetryAttempts() {
    return this.get('download.retryAttempts') || 3;
  }

  getRetryDelay() {
    return this.get('download.retryDelay') || 1000;
  }

  getTimeout() {
    return this.get('api.timeout') || 30000;
  }

  getUserAgent() {
    return this.get('api.userAgent') || 'Mozilla/5.0 (compatible; kemono-downloader)';
  }

  getBaseUrl() {
    return this.get('api.baseUrl') || 'https://kemono.cr';
  }

  getCookies() {
    return this.get('api.cookies') || { session: '' };
  }

  getBaseDirectory() {
    return this.get('storage.baseDirectory') || 'download';
  }

  shouldShowVerboseProgress() {
    return this.get('logging.verboseProgress') !== false;
  }

  shouldShowSkippedFiles() {
    return this.get('logging.showSkippedFiles') !== false;
  }

  shouldShowDetailedErrors() {
    return this.get('logging.showDetailedErrors') !== false;
  }

  shouldForceRedownload() {
    return this.get('download.forceRedownload') === true;
  }
}

// Singleton instance
const config = new Config();

module.exports = config;