const { downloadImage } = require('./fileUtils');
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
      const imageName = getImageName(imageInfo, index);
      const imagePath = path.join(postDir, imageName);

      // Check if file already exists and is valid
      if (await fs.pathExists(imagePath)) {
        try {
          const stats = await fs.stat(imagePath);
          if (stats.size > 0) {
            this.stats.skipped++;
            if (config.shouldShowSkippedFiles()) {
              onProgress(`⏭️  [${this.activeSemaphore}/${this.maxConcurrent}] Skipping: ${imageName} (${stats.size} bytes)`);
            }
            return;
          }
        } catch (error) {
          // File exists but can't read stats, try to download anyway
        }
      }

      // Download the image
      onProgress(`📥 [${this.activeSemaphore}/${this.maxConcurrent}] Downloading: ${imageName}`);
      
      const retryAttempts = config.getRetryAttempts();
      const retryDelay = config.getRetryDelay();
      
      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
          await downloadImage(imageUrl, imagePath, (msg) => {
            if (config.shouldShowVerboseProgress()) {
              onProgress(`    ${msg}`);
            }
          });
          
          this.stats.completed++;
          onProgress(`✅ [${this.stats.completed}/${this.stats.completed + this.stats.failed + this.stats.skipped}] Downloaded: ${imageName}`);
          
          // Add delay between downloads to be respectful
          const imageDelay = config.getImageDelay();
          if (imageDelay > 0) {
            await delay(imageDelay);
          }
          
          return; // Success, exit retry loop
          
        } catch (error) {
          if (attempt === retryAttempts) {
            // Final attempt failed
            this.stats.failed++;
            if (config.shouldShowDetailedErrors()) {
              onProgress(`❌ [${this.activeSemaphore}/${this.maxConcurrent}] Failed: ${imageName} - ${error.message}`);
            } else {
              onProgress(`❌ [${this.activeSemaphore}/${this.maxConcurrent}] Failed: ${imageName}`);
            }
          } else {
            // Retry after delay
            onProgress(`🔄 [${this.activeSemaphore}/${this.maxConcurrent}] Retrying ${imageName} (attempt ${attempt + 1}/${retryAttempts})`);
            await delay(retryDelay);
          }
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