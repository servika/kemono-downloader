const fs = require('fs-extra');
const path = require('path');

/**
 * Manages download state files stored in each profile's download folder
 * Stores .download-state.json in the profile directory for Docker-friendly persistence
 */
class ProfileStateManager {
  constructor(baseDownloadDir) {
    this.baseDownloadDir = baseDownloadDir;
  }

  /**
   * Get the state file path for a profile
   * @param {string} username - Profile username
   * @returns {string} Path to .download-state.json
   */
  getStateFilePath(username) {
    return path.join(this.baseDownloadDir, username, '.download-state.json');
  }

  /**
   * Check if a profile download is completed
   * @param {string} username - Profile username
   * @returns {Promise<boolean>} True if profile is marked as completed
   */
  async isProfileCompleted(username) {
    try {
      const stateFile = this.getStateFilePath(username);

      if (!await fs.pathExists(stateFile)) {
        return false;
      }

      const state = await fs.readJson(stateFile);
      return state.completed === true;
    } catch (error) {
      // If file doesn't exist or is corrupted, consider not completed
      return false;
    }
  }

  /**
   * Get profile download state
   * @param {string} username - Profile username
   * @returns {Promise<Object|null>} State object or null if not found
   */
  async getProfileState(username) {
    try {
      const stateFile = this.getStateFilePath(username);

      if (!await fs.pathExists(stateFile)) {
        return null;
      }

      return await fs.readJson(stateFile);
    } catch (error) {
      return null;
    }
  }

  /**
   * Mark profile as completed with metadata
   * @param {string} username - Profile username
   * @param {Object} metadata - Download metadata
   * @param {string} metadata.profileUrl - Original profile URL
   * @param {string} metadata.service - Service name (patreon, fanbox, etc.)
   * @param {string} metadata.userId - User ID
   * @param {number} metadata.totalPosts - Total posts downloaded
   * @param {number} metadata.totalImages - Total images downloaded
   * @param {number} metadata.totalErrors - Number of errors encountered
   * @returns {Promise<void>}
   */
  async markCompleted(username, metadata) {
    try {
      const profileDir = path.join(this.baseDownloadDir, username);
      await fs.ensureDir(profileDir);

      const stateFile = this.getStateFilePath(username);
      const state = {
        completed: true,
        completedAt: new Date().toISOString(),
        profileUrl: metadata.profileUrl || '',
        service: metadata.service || '',
        userId: metadata.userId || '',
        totalPosts: metadata.totalPosts || 0,
        totalImages: metadata.totalImages || 0,
        totalErrors: metadata.totalErrors || 0,
        version: '1.0.0'
      };

      await fs.writeJson(stateFile, state, { spaces: 2 });
      console.log(`  💾 Saved completion state to ${username}/.download-state.json`);
    } catch (error) {
      console.warn(`  ⚠️  Failed to save completion state: ${error.message}`);
    }
  }

  /**
   * Update download progress (for partial downloads)
   * @param {string} username - Profile username
   * @param {Object} progress - Progress data
   * @param {number} progress.downloadedPosts - Posts downloaded so far
   * @param {number} progress.totalPosts - Total posts expected
   * @param {number} progress.downloadedImages - Images downloaded so far
   * @returns {Promise<void>}
   */
  async updateProgress(username, progress) {
    try {
      const profileDir = path.join(this.baseDownloadDir, username);
      await fs.ensureDir(profileDir);

      const stateFile = this.getStateFilePath(username);

      // Load existing state or create new
      let state = {};
      if (await fs.pathExists(stateFile)) {
        state = await fs.readJson(stateFile);
      }

      // Update progress
      state.completed = false;
      state.lastUpdatedAt = new Date().toISOString();
      state.downloadedPosts = progress.downloadedPosts || 0;
      state.totalPosts = progress.totalPosts || 0;
      state.downloadedImages = progress.downloadedImages || 0;
      state.version = '1.0.0';

      await fs.writeJson(stateFile, state, { spaces: 2 });
    } catch (error) {
      console.warn(`  ⚠️  Failed to update progress: ${error.message}`);
    }
  }

  /**
   * Reset profile state (for re-downloading)
   * @param {string} username - Profile username
   * @returns {Promise<void>}
   */
  async resetProfile(username) {
    try {
      const stateFile = this.getStateFilePath(username);

      if (await fs.pathExists(stateFile)) {
        await fs.remove(stateFile);
        console.log(`  🔄 Reset completion state for ${username}`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to reset state: ${error.message}`);
    }
  }

  /**
   * Get statistics about all downloaded profiles
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    try {
      const stats = {
        totalProfiles: 0,
        completedProfiles: 0,
        inProgressProfiles: 0,
        totalPosts: 0,
        totalImages: 0,
        totalErrors: 0
      };

      // Check if base directory exists
      if (!await fs.pathExists(this.baseDownloadDir)) {
        return stats;
      }

      // Get all profile directories
      const entries = await fs.readdir(this.baseDownloadDir, { withFileTypes: true });
      const profileDirs = entries.filter(entry => entry.isDirectory());

      for (const dir of profileDirs) {
        const username = dir.name;
        const state = await this.getProfileState(username);

        if (state) {
          stats.totalProfiles++;

          if (state.completed) {
            stats.completedProfiles++;
            stats.totalPosts += state.totalPosts || 0;
            stats.totalImages += state.totalImages || 0;
            stats.totalErrors += state.totalErrors || 0;
          } else {
            stats.inProgressProfiles++;
          }
        }
      }

      return stats;
    } catch (error) {
      console.warn(`Failed to get statistics: ${error.message}`);
      return {
        totalProfiles: 0,
        completedProfiles: 0,
        inProgressProfiles: 0,
        totalPosts: 0,
        totalImages: 0,
        totalErrors: 0
      };
    }
  }

  /**
   * List all completed profiles
   * @returns {Promise<Array>} Array of completed profile info
   */
  async listCompletedProfiles() {
    try {
      const completed = [];

      if (!await fs.pathExists(this.baseDownloadDir)) {
        return completed;
      }

      const entries = await fs.readdir(this.baseDownloadDir, { withFileTypes: true });
      const profileDirs = entries.filter(entry => entry.isDirectory());

      for (const dir of profileDirs) {
        const username = dir.name;
        const state = await this.getProfileState(username);

        if (state && state.completed) {
          completed.push({
            username,
            ...state
          });
        }
      }

      return completed;
    } catch (error) {
      console.warn(`Failed to list completed profiles: ${error.message}`);
      return [];
    }
  }
}

module.exports = ProfileStateManager;