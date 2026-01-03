#!/usr/bin/env node
/**
 * Rebuild download-state.json from existing downloaded profiles
 *
 * This script scans the download directory and creates/updates the
 * download state file based on what's already been downloaded.
 *
 * Useful for:
 * - Recovering from lost/deleted state files
 * - Migrating from old downloads
 * - Initial state file creation
 */

const fs = require('fs-extra');
const path = require('path');
const DownloadState = require('./src/utils/downloadState');
const config = require('./src/utils/config');

async function rebuildState() {
  console.log('🔄 Rebuilding download state from existing downloads...\n');

  // Load config to get base directory
  await config.load();
  const baseDir = config.getBaseDirectory();

  console.log(`📁 Scanning directory: ${baseDir}\n`);

  if (!await fs.pathExists(baseDir)) {
    console.log(`❌ Download directory does not exist: ${baseDir}`);
    console.log(`   Create it first or download some profiles`);
    return;
  }

  // Initialize download state
  const downloadState = new DownloadState();

  // Get all directories in base directory (these are username folders)
  const usernames = await fs.readdir(baseDir);
  let profilesFound = 0;
  let postsFound = 0;

  for (const username of usernames) {
    const userPath = path.join(baseDir, username);
    const stats = await fs.stat(userPath);

    // Skip files, only process directories
    if (!stats.isDirectory()) {
      continue;
    }

    // Skip hidden directories
    if (username.startsWith('.')) {
      continue;
    }

    console.log(`👤 Processing user: ${username}`);

    // Get all post directories for this user
    const postDirs = await fs.readdir(userPath);
    const posts = [];

    for (const postId of postDirs) {
      const postPath = path.join(userPath, postId);
      const postStats = await fs.stat(postPath);

      // Skip files, only process directories
      if (!postStats.isDirectory()) {
        continue;
      }

      // Check if this looks like a valid post directory
      const hasMetadata = await fs.pathExists(path.join(postPath, 'post-metadata.json'));
      const files = await fs.readdir(postPath);
      const hasMedia = files.some(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
                '.mp4', '.webm', '.avi', '.mov', '.wmv', '.flv'].includes(ext);
      });

      if (hasMetadata || hasMedia) {
        posts.push(postId);
        postsFound++;
      }
    }

    if (posts.length > 0) {
      console.log(`   ✅ Found ${posts.length} downloaded posts`);

      // Try to determine service and userId from metadata
      // Check first post's metadata for service info
      const firstPostPath = path.join(userPath, posts[0]);
      const metadataPath = path.join(firstPostPath, 'post-metadata.json');

      let service = 'patreon'; // default
      let userId = username; // default fallback

      if (await fs.pathExists(metadataPath)) {
        try {
          const metadata = await fs.readJson(metadataPath);
          service = metadata.service || 'patreon';
          userId = metadata.user || username;
        } catch (error) {
          console.log(`   ⚠️  Could not read metadata, using defaults`);
        }
      }

      // Initialize and mark as completed in state
      downloadState.initializeProfile(service, userId, posts.length);
      downloadState.updateProgress(service, userId, posts.length);
      downloadState.markCompleted(service, userId);

      profilesFound++;
      console.log(`   💾 Marked ${service}:${userId} as completed in state`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 REBUILD SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Profiles found: ${profilesFound}`);
  console.log(`📄 Posts found: ${postsFound}`);
  console.log('='.repeat(50));

  if (profilesFound > 0) {
    console.log('\n✅ Download state rebuilt successfully!');
    console.log(`💾 State saved to: download-state.json`);
    console.log(`\nNext time you run the downloader, completed profiles will be skipped.`);
  } else {
    console.log('\n⚠️  No downloaded profiles found in the download directory.');
    console.log('   Download some profiles first, then run this script.');
  }
}

// Run the rebuild
rebuildState().catch(error => {
  console.error(`❌ Error rebuilding state: ${error.message}`);
  process.exit(1);
});