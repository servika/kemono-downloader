const fs = require('fs-extra');
const path = require('path');

/**
 * Profile file manager with write queue for safe concurrent operations
 * Handles reading and updating profiles.txt with atomic writes
 */
class ProfileFileManager {
  constructor(profilesFilePath) {
    this.profilesFilePath = profilesFilePath;
    this.writeQueue = [];
    this.isProcessing = false;
  }

  /**
   * Read profiles from file, skipping commented lines
   * @returns {Promise<Array<string>>} Array of active profile URLs
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
   * Read all lines from file (including comments)
   * @returns {Promise<Array<string>>} Array of all lines
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
   * @param {string} profileUrl - The profile URL to comment out
   * @param {Object} metadata - Completion metadata (posts, timestamp)
   * @returns {Promise<void>}
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
   * Write content to file atomically (write to temp, then rename)
   * @param {string} content - Content to write
   * @returns {Promise<void>}
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
   * Add operation to write queue and process sequentially
   * @param {Function} operation - Async operation to queue
   * @returns {Promise<any>} Result of the operation
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
   * @returns {Promise<Object>} Statistics
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