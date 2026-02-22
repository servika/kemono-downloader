/**
 * @fileoverview Per-profile download state manager for Docker-optimized state tracking
 * Stores .download-state.json files in each profile's download folder for persistent state management.
 * Superior to centralized state tracking for containerized environments where download volumes persist.
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Manages download state files stored in each profile's download folder.
 * Stores .download-state.json in the profile directory for Docker-friendly persistence.
 * Each profile maintains its own state file, eliminating the need to modify profiles.txt.
 *
 * @class ProfileStateManager
 *
 * @example
 * const manager = new ProfileStateManager('./download');
 * const isComplete = await manager.isProfileCompleted('patreon-12345');
 * await manager.markCompleted('patreon-12345', {
 *   profileUrl: 'https://kemono.cr/patreon/user/12345',
 *   totalPosts: 150,
 *   totalImages: 847
 * });
 */
class ProfileStateManager {
  /**
   * Create a new ProfileStateManager instance
   *
   * @param {string} baseDownloadDir - Base download directory path where profile folders are stored
   */
  constructor(baseDownloadDir) {
    this.baseDownloadDir = baseDownloadDir;
  }

  /**
   * Get the state file path for a specific profile
   *
   * @param {string} username - Profile username or folder name
   * @returns {string} Absolute path to .download-state.json file
   *
   * @example
   * manager.getStateFilePath('patreon-12345')
   * // Returns: '/path/to/download/patreon-12345/.download-state.json'
   */
  getStateFilePath(username) {
    return path.join(this.baseDownloadDir, username, '.download-state.json');
  }

  /**
   * Check if a profile download is marked as completed
   *
   * @param {string} username - Profile username or folder name
   * @returns {Promise<boolean>} True if profile has completed state file with completed flag
   *
   * @example
   * const isComplete = await manager.isProfileCompleted('patreon-12345');
   * if (isComplete) {
   *   console.log('Profile already downloaded');
   * }
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
   * Get complete download state for a profile
   *
   * @param {string} username - Profile username or folder name
   * @returns {Promise<Object|null>} State object or null if not found
   * @returns {boolean} returns.completed - Whether download is complete
   * @returns {string} returns.completedAt - ISO timestamp of completion
   * @returns {string} returns.profileUrl - Original profile URL
   * @returns {string} returns.service - Service name (patreon, fanbox, etc.)
   * @returns {string} returns.userId - User ID
   * @returns {number} returns.totalPosts - Total posts downloaded
   * @returns {number} returns.totalImages - Total images downloaded
   * @returns {number} returns.totalErrors - Number of errors encountered
   * @returns {string} returns.version - State file version
   *
   * @example
   * const state = await manager.getProfileState('patreon-12345');
   * console.log(`Downloaded ${state.totalPosts} posts with ${state.totalImages} images`);
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
   * Mark profile as completed with comprehensive metadata
   *
   * @param {string} username - Profile username or folder name
   * @param {Object} metadata - Download completion metadata
   * @param {string} metadata.profileUrl - Original profile URL
   * @param {string} metadata.service - Service name (patreon, fanbox, etc.)
   * @param {string} metadata.userId - User ID from profile
   * @param {number} metadata.totalPosts - Total posts successfully downloaded
   * @param {number} metadata.totalImages - Total images successfully downloaded
   * @param {number} metadata.totalErrors - Number of errors encountered
   * @returns {Promise<void>}
   *
   * @example
   * await manager.markCompleted('patreon-12345', {
   *   profileUrl: 'https://kemono.cr/patreon/user/12345',
   *   service: 'patreon',
   *   userId: '12345',
   *   totalPosts: 150,
   *   totalImages: 847,
   *   totalErrors: 2
   * });
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
   * Update download progress for partial downloads
   * Allows resuming interrupted downloads
   *
   * @param {string} username - Profile username or folder name
   * @param {Object} progress - Progress tracking data
   * @param {number} progress.downloadedPosts - Posts downloaded so far
   * @param {number} progress.totalPosts - Total posts expected
   * @param {number} progress.downloadedImages - Images downloaded so far
   * @returns {Promise<void>}
   *
   * @example
   * await manager.updateProgress('patreon-12345', {
   *   downloadedPosts: 75,
   *   totalPosts: 150,
   *   downloadedImages: 423
   * });
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
   * Reset profile state to allow re-downloading
   * Deletes the .download-state.json file
   *
   * @param {string} username - Profile username or folder name
   * @returns {Promise<void>}
   *
   * @example
   * await manager.resetProfile('patreon-12345');
   * // Profile can now be re-downloaded from scratch
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
   * Get comprehensive statistics about all downloaded profiles
   * Scans all profile directories and aggregates statistics
   *
   * @returns {Promise<Object>} Aggregated statistics
   * @returns {number} returns.totalProfiles - Total profiles with state files
   * @returns {number} returns.completedProfiles - Profiles marked as completed
   * @returns {number} returns.inProgressProfiles - Profiles in progress
   * @returns {number} returns.totalPosts - Sum of all downloaded posts
   * @returns {number} returns.totalImages - Sum of all downloaded images
   * @returns {number} returns.totalErrors - Sum of all errors
   *
   * @example
   * const stats = await manager.getStatistics();
   * console.log(`Completed ${stats.completedProfiles} of ${stats.totalProfiles} profiles`);
   * console.log(`Downloaded ${stats.totalPosts} posts with ${stats.totalImages} images`);
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
   * List all completed profiles with their metadata
   *
   * @returns {Promise<Array>} Array of completed profile objects
   * @returns {string} returns[].username - Profile folder name
   * @returns {boolean} returns[].completed - Always true for this method
   * @returns {string} returns[].completedAt - ISO timestamp of completion
   * @returns {string} returns[].profileUrl - Original profile URL
   * @returns {number} returns[].totalPosts - Total posts downloaded
   * @returns {number} returns[].totalImages - Total images downloaded
   *
   * @example
   * const completed = await manager.listCompletedProfiles();
   * completed.forEach(profile => {
   *   console.log(`${profile.username}: ${profile.totalPosts} posts`);
   * });
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