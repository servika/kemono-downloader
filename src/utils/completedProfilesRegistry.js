const fs = require('fs-extra');
const path = require('path');

/**
 * Flat JSON registry of fully-completed profile downloads.
 * Stored at download/completed-profiles.json — persists even when profile
 * folders are moved to an external drive. The URL is the stable lookup key.
 *
 * Usage:
 *   const registry = new CompletedProfilesRegistry('/path/to/completed-profiles.json');
 *   await registry.load();
 *   if (registry.isCompleted(url)) { ... }
 *   await registry.markCompleted({ profileUrl, username, ... });
 */
class CompletedProfilesRegistry {
  constructor(registryPath) {
    this.registryPath = registryPath;
    this.profileMap = new Map(); // url → entry
  }

  /**
   * Load (or initialize) the registry from disk.
   * Must be called once before isCompleted() / markCompleted().
   */
  async load() {
    try {
      if (!await fs.pathExists(this.registryPath)) {
        this.profileMap = new Map();
        return;
      }
      const data = await fs.readJson(this.registryPath);
      this.profileMap = new Map();
      for (const entry of (data.profiles || [])) {
        if (entry.profileUrl) {
          this.profileMap.set(entry.profileUrl, entry);
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to load completed-profiles.json: ${error.message}`);
      this.profileMap = new Map();
    }
  }

  /**
   * Synchronous check — call after load().
   * Returns true even if the profile folder has been moved to an external drive.
   */
  isCompleted(profileUrl) {
    return this.profileMap.has(profileUrl);
  }

  /**
   * Add or update an entry in the registry and persist to disk.
   *
   * @param {Object} entry
   * @param {string} entry.profileUrl
   * @param {string} entry.username
   * @param {string} entry.service
   * @param {string} entry.userId
   * @param {number} entry.totalPosts
   * @param {number} entry.totalImages
   * @param {string} [entry.completedAt]
   */
  async markCompleted(entry) {
    const record = {
      ...entry,
      completedAt: entry.completedAt || new Date().toISOString()
    };
    this.profileMap.set(entry.profileUrl, record);

    try {
      await this._save();
    } catch (error) {
      console.warn(`  ⚠️  Failed to save completed-profiles.json: ${error.message}`);
    }
  }

  /**
   * Return all completed profile entries as an array.
   */
  async getAll() {
    return Array.from(this.profileMap.values());
  }

  async _save() {
    const data = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      profiles: Array.from(this.profileMap.values())
    };

    const tempPath = `${this.registryPath}.tmp`;
    await fs.ensureDir(path.dirname(this.registryPath));
    await fs.writeJson(tempPath, data, { spaces: 2 });
    await fs.rename(tempPath, this.registryPath);
  }
}

module.exports = CompletedProfilesRegistry;