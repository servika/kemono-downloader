/**
 * @fileoverview Profile file manager with atomic write operations and queue management
 * Handles safe concurrent operations on profiles.txt with atomic writes and write queue.
 * Provides functionality for commenting/uncommenting profiles to track completion status.
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Profile file manager with write queue for safe concurrent operations.
 * Handles reading and updating profiles.txt with atomic writes to prevent corruption.
 * Uses a write queue to serialize concurrent write operations.
 *
 * @class ProfileFileManager
 *
 * @example
 * const manager = new ProfileFileManager('./profiles.txt');
 * const profiles = await manager.readProfiles();
 * await manager.commentProfile(profileUrl, { postCount: 150 });
 */
class ProfileFileManager {
  /**
   * Create a new ProfileFileManager instance
   *
   * @param {string} profilesFilePath - Absolute path to profiles.txt file
   */
  constructor(profilesFilePath) {
    this.profilesFilePath = profilesFilePath;
    this.writeQueue = [];
    this.isProcessing = false;
  }

  /**
   * Read active profile URLs from file
   * Filters out commented lines and empty lines
   *
   * @returns {Promise<string[]>} Array of active profile URLs
   * @throws {Error} If file read fails
   *
   * @example
   * const profiles = await manager.readProfiles();
   * // Returns: ['https://kemono.cr/patreon/user/12345', ...]
   */
  async readProfiles() {
    try {
      const content = await fs.readFile(this.profilesFilePath, 'utf-8');
      const lines = content.split('\n');

      const profiles = lines
        .map(line => line.trim())
        .filter(line => {
          // Skip empty lines
          if (!line) return false;
          // Skip commented lines
          if (line.startsWith('#')) return false;
          // Skip lines that don't look like URLs
          if (!line.includes('kemono.')) return false;
          return true;
        });

      return profiles;
    } catch (error) {
      throw new Error(`Failed to read profiles file: ${error.message}`);
    }
  }

  /**
   * Read all lines from file including comments
   * Useful for preserving file structure during edits
   *
   * @returns {Promise<string[]>} Array of all lines including comments
   * @throws {Error} If file read fails
   */
  async readAllLines() {
    try {
      const content = await fs.readFile(this.profilesFilePath, 'utf-8');
      return content.split('\n');
    } catch (error) {
      throw new Error(`Failed to read profiles file: ${error.message}`);
    }
  }

  /**
   * Comment out a profile URL with completion metadata
   * Marks profile as completed by converting URL line to comment
   *
   * @param {string} profileUrl - The profile URL to comment out
   * @param {Object} [metadata={}] - Optional completion metadata
   * @param {string} [metadata.timestamp] - ISO timestamp of completion
   * @param {number} [metadata.postCount] - Number of posts downloaded
   * @returns {Promise<void>}
   *
   * @example
   * await manager.commentProfile(
   *   'https://kemono.cr/patreon/user/12345',
   *   { postCount: 150, timestamp: new Date().toISOString() }
   * );
   */
  async commentProfile(profileUrl, metadata = {}) {
    return this.queueWrite(async () => {
      const lines = await this.readAllLines();
      const timestamp = metadata.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19);
      const postCount = metadata.postCount || 0;
      const comment = `# ${profileUrl} # Completed: ${timestamp} (${postCount} posts)`;

      // Find and comment out the profile URL
      let found = false;
      const updatedLines = lines.map(line => {
        const trimmed = line.trim();
        // Match the exact URL (not already commented)
        if (trimmed === profileUrl && !line.startsWith('#')) {
          found = true;
          return comment;
        }
        return line;
      });

      if (!found) {
        console.warn(`  ⚠️  Profile URL not found in profiles.txt: ${profileUrl}`);
        return;
      }

      // Write atomically
      await this.writeAtomic(updatedLines.join('\n'));
    });
  }

  /**
   * Uncomment a profile URL to re-enable downloading
   * Removes comment marker from profile line
   *
   * @param {string} profileUrl - The profile URL to uncomment
   * @returns {Promise<void>}
   */
  async uncommentProfile(profileUrl) {
    return this.queueWrite(async () => {
      const lines = await this.readAllLines();

      const updatedLines = lines.map(line => {
        const trimmed = line.trim();
        // If line contains the URL and is commented, uncomment it
        if (trimmed.includes(profileUrl) && line.startsWith('#')) {
          return profileUrl;
        }
        return line;
      });

      await this.writeAtomic(updatedLines.join('\n'));
    });
  }

  /**
   * Write content to file atomically using temp file and rename
   * Prevents file corruption by writing to temp file first, then atomic rename.
   * Creates backup before write and restores on failure.
   *
   * @param {string} content - Content to write to file
   * @returns {Promise<void>}
   * @throws {Error} If atomic write operation fails
   *
   * @example
   * await manager.writeAtomic('line1\nline2\nline3');
   */
  async writeAtomic(content) {
    const tempPath = `${this.profilesFilePath}.tmp`;
    const backupPath = `${this.profilesFilePath}.backup`;

    try {
      // Write to temporary file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Create backup of original
      if (await fs.pathExists(this.profilesFilePath)) {
        await fs.copyFile(this.profilesFilePath, backupPath);
      }

      // Atomic rename (replaces original)
      await fs.rename(tempPath, this.profilesFilePath);

      // Remove backup after successful write
      if (await fs.pathExists(backupPath)) {
        await fs.remove(backupPath);
      }
    } catch (error) {
      // Restore from backup if write failed
      if (await fs.pathExists(backupPath)) {
        await fs.copyFile(backupPath, this.profilesFilePath);
        await fs.remove(backupPath);
      }
      // Clean up temp file
      if (await fs.pathExists(tempPath)) {
        await fs.remove(tempPath);
      }
      throw new Error(`Atomic write failed: ${error.message}`);
    }
  }

  /**
   * Add write operation to queue and process sequentially
   * Ensures write operations are serialized to prevent race conditions
   *
   * @param {Function} operation - Async operation to queue
   * @returns {Promise<any>} Result of the queued operation
   */
  async queueWrite(operation) {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.writeQueue.push({ operation, resolve, reject });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process write queue sequentially
   * Executes queued write operations one at a time
   *
   * @private
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.isProcessing || this.writeQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.writeQueue.length > 0) {
      const { operation, resolve, reject } = this.writeQueue.shift();

      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }

      // Small delay between operations to prevent overwhelming the file system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessing = false;
  }

  /**
   * Get statistics about profiles file
   * Counts total, active, and completed profiles
   *
   * @returns {Promise<Object>} Statistics object
   * @returns {number} returns.total - Total number of profiles (active + completed)
   * @returns {number} returns.active - Number of active (uncommented) profiles
   * @returns {number} returns.completed - Number of completed (commented) profiles
   *
   * @example
   * const stats = await manager.getStatistics();
   * // { total: 10, active: 3, completed: 7 }
   */
  async getStatistics() {
    const lines = await this.readAllLines();
    const activeProfiles = await this.readProfiles();

    const commented = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('#') && trimmed.includes('kemono.');
    });

    return {
      total: activeProfiles.length + commented.length,
      active: activeProfiles.length,
      completed: commented.length
    };
  }
}

module.exports = ProfileFileManager;