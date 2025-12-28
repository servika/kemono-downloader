const { downloadImageWithRetry } = require('./fileUtils');
const { delay } = require('./delay');
const config = require('./config');

/**
 * Concurrent download manager with semaphore-based limiting
 */

class ConcurrentDownloader {
  constructor() {
    this.activeSemaphore = 0;
    this.maxConcurrent = config.getMaxConcurrentImages();
    this.queue = [];
    this.stats = {
      completed: 0,
      failed: 0,
      skipped: 0
    };
  }

  async downloadImages(images, postDir, onProgress, onComplete) {
    this.stats = { completed: 0, failed: 0, skipped: 0 };
    const totalImages = images.length;
    
    if (totalImages === 0) {
      if (onComplete) onComplete(this.stats);
      return;
    }

    // Create download tasks
    const downloadTasks = images.map((imageInfo, index) => 
      this.createDownloadTask(imageInfo, index, postDir, onProgress)
    );

    // Process downloads with concurrency limit
    const promises = downloadTasks.map(task => this.processTask(task));
    await Promise.all(promises);

    if (onComplete) {
      onComplete(this.stats);
    }

    return this.stats;
  }

  createDownloadTask(imageInfo, index, postDir, onProgress) {
    return {
      imageInfo,
      index,
      postDir,
      onProgress: onProgress || (() => {})
    };
  }

  async processTask(task) {
    // Wait for available slot
    await this.acquireSemaphore();
    
    try {
      await this.executeDownload(task);
    } finally {
      this.releaseSemaphore();
    }
  }

  async acquireSemaphore() {
    while (this.activeSemaphore >= this.maxConcurrent) {
      await delay(10); // Small delay to prevent busy waiting
    }
    this.activeSemaphore++;
  }

  releaseSemaphore() {
    this.activeSemaphore--;
  }

  async executeDownload(task) {
    const { imageInfo, index, postDir, onProgress } = task;
    const { getImageName } = require('./urlUtils');
    const fs = require('fs-extra');
    const path = require('path');
    
    try {
      const imageUrl = typeof imageInfo === 'object' ? imageInfo.url : imageInfo;
      const thumbnailUrl = typeof imageInfo === 'object' ? imageInfo.thumbnailUrl : null;
      const imageName = getImageName(imageInfo, index);
      const imagePath = path.join(postDir, imageName);

      // Check if file already exists
      if (await fs.pathExists(imagePath)) {
        try {
          const stats = await fs.stat(imagePath);

          // If file has content, check if we should upgrade from thumbnail to full resolution
          if (stats.size > 0) {
            // If we have both full and thumbnail URLs, and the file is suspiciously small,
            // it might be a thumbnail that we should upgrade to full resolution
            const shouldTryUpgrade = thumbnailUrl &&
                                     thumbnailUrl !== imageUrl &&
                                     stats.size < 500 * 1024; // Less than 500KB might be thumbnail

            if (shouldTryUpgrade) {
              onProgress(`🔄 [${this.activeSemaphore}/${this.maxConcurrent}] Checking for full resolution: ${imageName} (current: ${Math.round(stats.size / 1024)}KB)`);

              // Try to download full resolution to a temp file first
              const tempPath = imagePath + '.tmp';
              try {
                await downloadImageWithRetry(imageUrl, tempPath, (msg) => {
                  if (config.shouldShowVerboseProgress()) {
                    onProgress(`    ${msg}`);
                  }
                }, null); // Don't use thumbnail fallback for upgrade check

                // Check if the new file is actually larger (better quality)
                const newStats = await fs.stat(tempPath);
                if (newStats.size > stats.size) {
                  // Full resolution is larger - replace the thumbnail
                  await fs.move(tempPath, imagePath, { overwrite: true });
                  this.stats.completed++;
                  const improvement = Math.round(((newStats.size - stats.size) / stats.size) * 100);
                  onProgress(`✅ [${this.activeSemaphore}/${this.maxConcurrent}] Upgraded: ${imageName} (${Math.round(stats.size / 1024)}KB → ${Math.round(newStats.size / 1024)}KB, +${improvement}%)`);
                  return;
                } else {
                  // Full resolution isn't better - keep existing file
                  await fs.remove(tempPath);
                  this.stats.skipped++;
                  if (config.shouldShowSkippedFiles()) {
                    onProgress(`⏭️  [${this.activeSemaphore}/${this.maxConcurrent}] Skipping: ${imageName} (already full resolution)`);
                  }
                  return;
                }
              } catch (error) {
                // Full resolution not available or download failed - keep existing thumbnail
                if (await fs.pathExists(tempPath)) {
                  await fs.remove(tempPath);
                }
                this.stats.skipped++;
                if (config.shouldShowSkippedFiles()) {
                  onProgress(`⏭️  [${this.activeSemaphore}/${this.maxConcurrent}] Skipping: ${imageName} (full resolution unavailable)`);
                }
                return;
              }
            } else {
              // File exists and no upgrade needed
              this.stats.skipped++;
              if (config.shouldShowSkippedFiles()) {
                onProgress(`⏭️  [${this.activeSemaphore}/${this.maxConcurrent}] Skipping: ${imageName} (${stats.size} bytes)`);
              }
              return;
            }
          }
        } catch (error) {
          // File exists but can't read stats, try to download anyway
        }
      }

      // Download the image with thumbnail fallback
      onProgress(`📥 [${this.activeSemaphore}/${this.maxConcurrent}] Downloading: ${imageName}`);

      try {
        await downloadImageWithRetry(imageUrl, imagePath, (msg) => {
          if (config.shouldShowVerboseProgress()) {
            onProgress(`    ${msg}`);
          }
        }, thumbnailUrl); // Pass thumbnail URL for fallback

        this.stats.completed++;
        onProgress(`✅ [${this.stats.completed}/${this.stats.completed + this.stats.failed + this.stats.skipped}] Downloaded: ${imageName}`);

        // Add delay between downloads to be respectful
        const imageDelay = config.getImageDelay();
        if (imageDelay > 0) {
          await delay(imageDelay);
        }

      } catch (error) {
        // Download failed even with retries and thumbnail fallback
        this.stats.failed++;
        if (config.shouldShowDetailedErrors()) {
          onProgress(`❌ [${this.activeSemaphore}/${this.maxConcurrent}] Failed: ${imageName} - ${error.message}`);
        } else {
          onProgress(`❌ [${this.activeSemaphore}/${this.maxConcurrent}] Failed: ${imageName}`);
        }
      }

    } catch (error) {
      this.stats.failed++;
      onProgress(`❌ [${this.activeSemaphore}/${this.maxConcurrent}] Error: ${error.message}`);
    }
  }

  updateMaxConcurrent(newLimit) {
    this.maxConcurrent = Math.max(1, Math.min(20, newLimit)); // Limit between 1-20
    console.log(`🔧 Updated concurrent download limit to: ${this.maxConcurrent}`);
  }

  getStatus() {
    return {
      activeTasks: this.activeSemaphore,
      maxConcurrent: this.maxConcurrent,
      stats: { ...this.stats }
    };
  }
}

module.exports = ConcurrentDownloader;