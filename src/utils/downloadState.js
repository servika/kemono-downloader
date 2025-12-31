const fs = require('fs-extra');
const path = require('path');

/**
 * Download state manager for tracking profile download completion
 * Persists state to download-state.json to avoid re-downloading completed profiles
 */
class DownloadState {
    constructor(stateFilePath = null) {
        this.stateFilePath = stateFilePath || path.join(process.cwd(), 'download-state.json');
        this.state = this.loadState();
    }

    /**
     * Load state from file, creating empty state if file doesn't exist
     * @returns {Object} State object with profiles
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
     * Save current state to file
     * @throws {Error} If save fails
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
     * Get profile key from service and user_id
     * @param {string} service - Service name (e.g., 'patreon')
     * @param {string} userId - User ID
     * @returns {string} Profile key
     */
    getProfileKey(service, userId) {
        return `${service}:${userId}`;
    }

    /**
     * Check if profile is completed
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @returns {boolean} True if profile is marked as completed
     */
    isProfileCompleted(service, userId) {
        const key = this.getProfileKey(service, userId);
        const profile = this.state.profiles[key];
        return !!(profile && profile.completed === true);
    }

    /**
     * Get profile progress information
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @returns {Object|null} Profile progress or null if not found
     */
    getProfileProgress(service, userId) {
        const key = this.getProfileKey(service, userId);
        return this.state.profiles[key] || null;
    }

    /**
     * Initialize or update profile download tracking
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @param {number} totalPosts - Total number of posts
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
     * Update profile progress
     * @param {string} service - Service name
     * @param {string} userId - User ID
     * @param {number} downloadedPosts - Number of posts downloaded
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
     * Mark profile as completed
     * @param {string} service - Service name
     * @param {string} userId - User ID
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
     * Reset profile state (for re-downloading)
     * @param {string} service - Service name
     * @param {string} userId - User ID
     */
    resetProfile(service, userId) {
        const key = this.getProfileKey(service, userId);
        delete this.state.profiles[key];
        this.saveState();
    }

    /**
     * Get all completed profiles
     * @returns {Array} Array of completed profile keys
     */
    getCompletedProfiles() {
        return Object.entries(this.state.profiles)
            .filter(([_, profile]) => profile.completed)
            .map(([key, _]) => key);
    }

    /**
     * Get statistics about download state
     * @returns {Object} Statistics object
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