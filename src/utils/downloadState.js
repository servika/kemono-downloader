/**
 * @fileoverview Legacy download state manager for centralized state tracking
 * This module has been superseded by ProfileStateManager which uses per-profile state files.
 * Maintains backward compatibility for projects using centralized download-state.json.
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Download state manager for tracking profile download completion.
 * Persists state to centralized download-state.json to avoid re-downloading completed profiles.
 *
 * @class DownloadState
 * @deprecated Use ProfileStateManager for Docker-optimized per-profile state tracking
 *
 * @example
 * const state = new DownloadState();
 * state.initializeProfile('patreon', '12345', 150);
 * state.updateProgress('patreon', '12345', 75);
 * state.markCompleted('patreon', '12345');
 */
class DownloadState {
    /**
     * Create a new DownloadState instance
     *
     * @param {string} [stateFilePath=null] - Optional custom path to state file (defaults to download-state.json)
     *
     * @example
     * const state = new DownloadState(); // Uses default path
     * const customState = new DownloadState('./custom-state.json');
     */
    constructor(stateFilePath = null) {
        this.stateFilePath = stateFilePath || path.join(process.cwd(), 'download-state.json');
        this.state = this.loadState();
    }

    /**
     * Load download state from file
     * Creates empty state object if file doesn't exist or is corrupted
     *
     * @private
     * @returns {Object} State object with profiles property
     * @returns {Object} returns.profiles - Map of profile keys to profile state
     * @returns {string} returns.version - State file version
     */
    loadState() {
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const data = fs.readFileSync(this.stateFilePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error(`Failed to load download state: ${error.message}`);
        }
        return { profiles: {}, version: '1.0.0' };
    }

    /**
     * Save current download state to file
     * Writes state as formatted JSON with 2-space indentation
     *
     * @private
     * @throws {Error} If file write operation fails
     */
    saveState() {
        try {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (error) {
            console.error(`Failed to save download state: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate unique profile key from service and user ID
     *
     * @param {string} service - Service name (e.g., 'patreon', 'fanbox')
     * @param {string} userId - Numeric user ID
     * @returns {string} Profile key in format "service:userId"
     *
     * @example
     * getProfileKey('patreon', '12345') // Returns "patreon:12345"
     */
    getProfileKey(service, userId) {
        return `${service}:${userId}`;
    }

    /**
     * Check if a profile download is marked as completed
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @returns {boolean} True if profile exists and is marked completed
     */
    isProfileCompleted(service, userId) {
        const key = this.getProfileKey(service, userId);
        const profile = this.state.profiles[key];
        return !!(profile && profile.completed === true);
    }

    /**
     * Retrieve current download progress for a profile
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @returns {Object|null} Profile progress object or null if profile not found
     * @returns {string} returns.service - Service name
     * @returns {string} returns.userId - User ID
     * @returns {number} returns.totalPosts - Total posts expected
     * @returns {number} returns.downloadedPosts - Posts downloaded so far
     * @returns {boolean} returns.completed - Whether download is complete
     * @returns {string} returns.startedAt - ISO timestamp when started
     * @returns {string} returns.lastUpdatedAt - ISO timestamp of last update
     */
    getProfileProgress(service, userId) {
        const key = this.getProfileKey(service, userId);
        return this.state.profiles[key] || null;
    }

    /**
     * Initialize or update profile download tracking
     * Preserves existing download progress if profile was previously initialized
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @param {number} totalPosts - Total number of posts to download
     *
     * @example
     * state.initializeProfile('patreon', '12345', 150);
     */
    initializeProfile(service, userId, totalPosts) {
        const key = this.getProfileKey(service, userId);
        const existing = this.state.profiles[key];

        this.state.profiles[key] = {
            service,
            userId,
            totalPosts,
            downloadedPosts: existing?.downloadedPosts || 0,
            completed: false,
            startedAt: existing?.startedAt || new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString()
        };

        this.saveState();
    }

    /**
     * Update download progress for a profile
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @param {number} downloadedPosts - Number of posts successfully downloaded
     * @throws {Error} If profile has not been initialized
     */
    updateProgress(service, userId, downloadedPosts) {
        const key = this.getProfileKey(service, userId);
        if (!this.state.profiles[key]) {
            throw new Error(`Profile ${key} not initialized`);
        }

        this.state.profiles[key].downloadedPosts = downloadedPosts;
        this.state.profiles[key].lastUpdatedAt = new Date().toISOString();

        this.saveState();
    }

    /**
     * Mark a profile as fully completed
     * Sets completion flag and records completion timestamp
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @throws {Error} If profile has not been initialized
     */
    markCompleted(service, userId) {
        const key = this.getProfileKey(service, userId);
        if (!this.state.profiles[key]) {
            throw new Error(`Profile ${key} not initialized`);
        }

        this.state.profiles[key].completed = true;
        this.state.profiles[key].completedAt = new Date().toISOString();
        this.state.profiles[key].lastUpdatedAt = new Date().toISOString();

        this.saveState();
    }

    /**
     * Reset profile state to allow re-downloading
     * Completely removes profile from state tracking
     *
     * @param {string} service - Service name
     * @param {string} userId - User ID
     */
    resetProfile(service, userId) {
        const key = this.getProfileKey(service, userId);
        delete this.state.profiles[key];
        this.saveState();
    }

    /**
     * Get list of all completed profile keys
     *
     * @returns {string[]} Array of profile keys in "service:userId" format
     *
     * @example
     * getCompletedProfiles() // Returns ['patreon:12345', 'fanbox:67890']
     */
    getCompletedProfiles() {
        return Object.entries(this.state.profiles)
            .filter(([_, profile]) => profile.completed)
            .map(([key, _]) => key);
    }

    /**
     * Get comprehensive download statistics across all profiles
     *
     * @returns {Object} Statistics summary
     * @returns {number} returns.total - Total profiles tracked
     * @returns {number} returns.completed - Profiles marked as completed
     * @returns {number} returns.inProgress - Profiles currently in progress
     * @returns {number} returns.totalPosts - Sum of all posts across profiles
     * @returns {number} returns.downloadedPosts - Sum of downloaded posts
     */
    getStatistics() {
        const profiles = Object.values(this.state.profiles);
        return {
            total: profiles.length,
            completed: profiles.filter(p => p.completed).length,
            inProgress: profiles.filter(p => !p.completed).length,
            totalPosts: profiles.reduce((sum, p) => sum + (p.totalPosts || 0), 0),
            downloadedPosts: profiles.reduce((sum, p) => sum + (p.downloadedPosts || 0), 0)
        };
    }
}

module.exports = DownloadState;