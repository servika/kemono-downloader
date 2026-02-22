/**
 * @fileoverview Centralized JSDoc type definitions for kemono-downloader
 * This file contains shared type definitions used across the codebase.
 * Import these types in other files using @typedef {import('./utils/types').TypeName} TypeName
 */

/**
 * Post data structure returned from kemono.cr API
 * @typedef {Object} PostData
 * @property {string} id - Post ID
 * @property {string} url - Post URL
 * @property {string} username - Creator username
 * @property {string} title - Post title
 * @property {string} published - ISO 8601 timestamp of when post was published
 * @property {string} service - Service name (patreon, fanbox, gumroad, subscribestar, etc.)
 * @property {string} userId - User/creator ID on the service
 * @property {PostContent} post - Post content data including files and attachments
 * @property {PreviewFile[]} [previews] - Optional preview images array
 */

/**
 * Post content structure containing files and HTML content
 * @typedef {Object} PostContent
 * @property {FileAttachment} [file] - Main file attachment (image, video, archive)
 * @property {FileAttachment[]} [attachments] - Additional file attachments
 * @property {string} [content] - HTML content of the post
 */

/**
 * File attachment structure for posts
 * @typedef {Object} FileAttachment
 * @property {string} path - Server path to the file
 * @property {string} name - Original filename
 * @property {number} [size] - File size in bytes (optional)
 */

/**
 * Preview file structure for thumbnail images
 * @typedef {Object} PreviewFile
 * @property {string} server - Server URL or identifier
 * @property {string} path - Path to preview file
 * @property {string} [hash] - Optional file hash
 */

/**
 * Media file structure for downloaded content
 * @typedef {Object} MediaFile
 * @property {string} url - Full URL to the media file
 * @property {string|null} filename - Filename to save as (null if unknown)
 * @property {'main'|'attachment'|'preview'|'external_link'} type - Type of media file
 * @property {'image'|'video'|'archive'|'external'} mediaType - Media format category
 * @property {string} [thumbnailUrl] - Optional thumbnail URL for quality upgrade
 * @property {boolean} [isSmall] - Whether file is small (<500KB) and may need upgrade
 */

/**
 * Profile download state stored in .download-state.json files
 * @typedef {Object} ProfileState
 * @property {boolean} completed - Whether profile download is complete
 * @property {string} completedAt - ISO 8601 timestamp of completion
 * @property {string} profileUrl - Full profile URL
 * @property {string} service - Service name (patreon, fanbox, etc.)
 * @property {string} userId - User ID on the service
 * @property {number} totalPosts - Total number of posts downloaded
 * @property {number} totalImages - Total number of images downloaded
 * @property {number} totalErrors - Number of errors encountered
 * @property {string} version - State file format version
 * @property {string} [lastUpdatedAt] - ISO 8601 timestamp of last update (for partial downloads)
 * @property {number} [downloadedPosts] - Number of posts downloaded so far (for progress tracking)
 * @property {number} [downloadedImages] - Number of images downloaded so far (for progress tracking)
 */

/**
 * Download statistics for the main downloader
 * @typedef {Object} DownloadStats
 * @property {number} profilesProcessed - Number of profiles processed
 * @property {number} postsDownloaded - Total posts successfully downloaded
 * @property {number} postsSkipped - Total posts skipped (already downloaded)
 * @property {number} imagesDownloaded - Total images successfully downloaded
 * @property {number} errors - Total errors encountered
 */

/**
 * Concurrent download statistics
 * @typedef {Object} ConcurrentDownloadStats
 * @property {number} completed - Number of downloads completed successfully
 * @property {number} failed - Number of downloads that failed
 * @property {number} skipped - Number of downloads skipped (already exist)
 */

/**
 * Download statistics for external downloaders (Mega, Google Drive, Dropbox)
 * @typedef {Object} ExternalDownloadStats
 * @property {number} filesDownloaded - Number of files successfully downloaded
 * @property {number} filesSkipped - Number of files skipped (already exist)
 * @property {number} filesFailed - Number of files that failed to download
 * @property {number} bytesDownloaded - Total bytes downloaded
 */

/**
 * Mega.nz URL parse result
 * @typedef {Object} MegaUrlInfo
 * @property {'file'|'folder'} type - Type of Mega link
 * @property {string} url - Original URL
 */

/**
 * Google Drive URL parse result
 * @typedef {Object} GoogleDriveUrlInfo
 * @property {'file'|'folder'} type - Type of Google Drive link
 * @property {string} fileId - Extracted file/folder ID
 * @property {string} url - Original URL
 */

/**
 * Dropbox URL parse result
 * @typedef {Object} DropboxUrlInfo
 * @property {'file'|'folder'} type - Type of Dropbox link (folders are not supported)
 * @property {string} directUrl - Direct download URL (with dl=1)
 * @property {string} url - Original URL
 */

/**
 * Download verification result
 * @typedef {Object} VerificationResult
 * @property {boolean} allPresent - Whether all expected files are present
 * @property {number} presentCount - Number of files present
 * @property {number} totalExpected - Total number of files expected
 * @property {number} missingCount - Number of missing files
 * @property {string[]} missingFiles - Array of missing filenames
 * @property {CorruptedFile[]} corruptedFiles - Array of corrupted file info
 */

/**
 * Corrupted file information
 * @typedef {Object} CorruptedFile
 * @property {string} name - Filename
 * @property {string} reason - Reason for corruption (e.g., "Invalid file signature", "Empty file")
 */

/**
 * Profile file statistics
 * @typedef {Object} ProfileFileStats
 * @property {number} total - Total number of profile lines
 * @property {number} active - Number of active (uncommented) profiles
 * @property {number} completed - Number of completed (commented) profiles
 */

/**
 * Configuration object structure from config.json
 * @typedef {Object} Config
 * @property {DownloadConfig} download - Download-related configuration
 * @property {ApiConfig} api - API-related configuration
 * @property {StorageConfig} storage - Storage-related configuration
 * @property {LoggingConfig} logging - Logging-related configuration
 */

/**
 * Download configuration section
 * @typedef {Object} DownloadConfig
 * @property {number} maxConcurrentImages - Max concurrent image downloads (1-20)
 * @property {number} maxConcurrentPosts - Max concurrent post downloads (1-5)
 * @property {number} delayBetweenImages - Delay between image downloads in ms
 * @property {number} delayBetweenPosts - Delay between post downloads in ms
 * @property {number} delayBetweenAPIRequests - Delay between API requests in ms
 * @property {number} delayBetweenPages - Delay between page fetches in ms
 * @property {number} retryAttempts - Number of retry attempts for failed downloads
 * @property {number} retryDelay - Initial delay between retries in ms (uses exponential backoff)
 * @property {boolean} forceRedownload - Force redownload even if files exist
 */

/**
 * API configuration section
 * @typedef {Object} ApiConfig
 * @property {string} baseUrl - Base URL for kemono.cr API
 * @property {number} timeout - Request timeout in ms
 * @property {string} userAgent - User agent string for requests
 * @property {Object<string, string>} cookies - Authentication cookies (e.g., __ddg1, __ddg2)
 */

/**
 * Storage configuration section
 * @typedef {Object} StorageConfig
 * @property {string} baseDirectory - Base directory for downloads
 * @property {boolean} createSubfolders - Whether to create subfolders for posts
 * @property {boolean} sanitizeFilenames - Whether to sanitize filenames
 * @property {boolean} preserveOriginalNames - Whether to preserve original filenames
 */

/**
 * Logging configuration section
 * @typedef {Object} LoggingConfig
 * @property {boolean} verboseProgress - Show detailed progress messages
 * @property {boolean} showSkippedFiles - Show messages for skipped files
 * @property {boolean} showDetailedErrors - Show detailed error messages
 * @property {boolean} [debugBrowserExtraction] - Debug mode for browser-based extraction
 */

/**
 * Progress callback function
 * @callback ProgressCallback
 * @param {string} message - Progress message to display
 * @returns {void}
 */

/**
 * Completion callback function for concurrent downloads
 * @callback CompletionCallback
 * @param {ConcurrentDownloadStats} stats - Download statistics
 * @returns {void}
 */

module.exports = {};