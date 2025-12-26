const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const { delay } = require('./utils/delay');
const { extractUserInfo, extractProfileName } = require('./utils/urlUtils');
const { getImageName } = require('./utils/urlUtils');
const { downloadImage, savePostMetadata, saveHtmlContent, readProfilesFile } = require('./utils/fileUtils');
const { fetchPage, fetchPostsFromAPI, fetchPostFromAPI } = require('./api/kemonoApi');
const { extractImagesFromPostData, extractImagesFromHTML } = require('./extractors/imageExtractor');
const { extractPostsFromProfileHTML, extractMediaFromPostHTML, extractPostMetadataFromHTML, extractUsernameFromProfile } = require('./extractors/htmlParser');
const { isPostAlreadyDownloaded, getDownloadStatus, verifyAllImagesDownloaded } = require('./utils/downloadChecker');
const ConcurrentDownloader = require('./utils/concurrentDownloader');
const config = require('./utils/config');
const browserClient = require('./utils/browserClient');

class KemonoDownloader {
  constructor() {
    this.baseDir = config.getBaseDirectory();
    this.concurrentDownloader = new ConcurrentDownloader();
    this.stats = {
      profilesProcessed: 0,
      postsDownloaded: 0,
      postsSkipped: 0,
      imagesDownloaded: 0,
      errors: 0
    };
  }

  async initialize() {
    await config.load();
    this.baseDir = config.getBaseDirectory();
    this.htmlOnlyMode = config.get('htmlOnlyMode', false);
    console.log(`📁 Base directory: ${this.baseDir}`);
    console.log(`⚡ Max concurrent images: ${config.getMaxConcurrentImages()}`);
    console.log(`⏱️  Image delay: ${config.getImageDelay()}ms`);
    if (this.htmlOnlyMode) {
      console.log(`🌐 HTML-only mode: ENABLED (API will be skipped)`);
    }
  }

  async getProfilePosts(profileUrl) {
    console.log(`  🔍 Analyzing profile for posts...`);
    const userInfo = extractUserInfo(profileUrl);

    // Try browser HTML scraping first
    console.log(`  🌐 Trying browser HTML scraping...`);
    const htmlPosts = await this.getProfilePostsFromHTML(profileUrl);

    if (htmlPosts.length > 0) {
      console.log(`  ✅ Found ${htmlPosts.length} posts via HTML scraping`);
      return htmlPosts;
    }

    // Skip API if in HTML-only mode
    if (this.htmlOnlyMode) {
      console.log(`  ⚠️  HTML scraping found no posts (API skipped - HTML-only mode)`);
      return [];
    }

    console.log(`  ⚠️  HTML scraping failed, trying API fallback...`);
    console.log(`  🔌 Trying API endpoint for user ${userInfo.userId}...`);
    const apiPosts = await fetchPostsFromAPI(userInfo.service, userInfo.userId, (msg) => console.log(`    ${msg}`));

    if (apiPosts.length > 0) {
      console.log(`  ✅ Found ${apiPosts.length} posts via API`);
    }

    return apiPosts;
  }

  async getProfilePostsFromHTML(profileUrl) {
    const html = await fetchPage(profileUrl, (msg) => console.log(`  ${msg}`));
    if (!html) {
      console.log(`  ❌ Could not load profile page`);
      return [];
    }

    const $ = cheerio.load(html);
    const userInfo = extractUserInfo(profileUrl);

    // Check if this is a SPA (Single Page Application)
    const bodyText = $('body').text().substring(0, 500);
    if (bodyText.includes('System.import') || bodyText.includes('vite-legacy-entry')) {
      console.log(`  ⚠️  Detected SPA - content loaded dynamically via JavaScript`);
      console.log(`  💡 This site requires JavaScript to load posts. Consider:`);
      console.log(`     1. Check if the user has posts (visit the URL manually)`);
      console.log(`     2. The site may have moved or changed structure`);
      console.log(`     3. API endpoints may have changed`);
      return [];
    }

    // Use enhanced HTML parser
    const posts = extractPostsFromProfileHTML($, profileUrl);

    // Extract username from page
    const username = extractUsernameFromProfile($, profileUrl);
    console.log(`  👤 Found user: ${username}`);

    // Add username to all posts
    posts.forEach(post => {
      post.username = username;
    });

    console.log(`  📋 Found ${posts.length} posts to download`);
    return posts;
  }

  extractPostId(postUrl) {
    const urlParts = postUrl.split('/');
    return urlParts[urlParts.length - 1] || 'unknown';
  }

  async downloadPost(post, postIndex, totalPosts) {
    console.log(`\n📄 [${postIndex + 1}/${totalPosts}] Processing post: ${post.id}`);
    console.log(`  🔗 URL: ${post.url}`);

    const postDir = path.join(this.baseDir, post.username, post.id);

    // First, check if we should skip this post
    const quickCheck = await getDownloadStatus(postDir);
    if (quickCheck === 'completed') {
      // Do a quick check without API data first
      const initialCheck = await isPostAlreadyDownloaded(postDir, null);
      if (initialCheck.downloaded) {
        console.log(`  ⏭️  Skipping: Post already downloaded and verified`);
        this.stats.postsSkipped++;
        return;
      }
    }

    console.log(`  📁 Creating directory: ${postDir}`);
    await fs.ensureDir(postDir);

    // Try browser HTML fetching first
    console.log(`  🌐 Trying browser HTML fetch...`);
    const html = await fetchPage(post.url, (msg) => console.log(`  ${msg}`));

    if (html) {
      const $ = cheerio.load(html);

      // Save HTML content
      await saveHtmlContent(postDir, html);
      console.log(`  💾 Saved HTML content`);

      // Check if this is SPA content
      const bodyText = $('body').text();
      let images = [];

      if (bodyText.includes('System.import') || bodyText.includes('vite-legacy-entry')) {
        console.log(`  ⚠️  Post page is a SPA - using browser to extract images from rendered content`);

        // Use Puppeteer to extract images from the rendered page
        images = await browserClient.extractImagesFromRenderedPost(post.url, (msg) => console.log(`    ${msg}`));
      } else {
        // Try enhanced HTML parser first, then fallback to original
        images = extractMediaFromPostHTML($, post.url);
        if (images.length === 0) {
          console.log(`  ℹ️  Enhanced parser found no images, trying original parser...`);
          images = extractImagesFromHTML($);
        }
      }

      console.log(`  🖼️  Found ${images.length} images to download from HTML`);

      if (images.length > 0) {
        // Use concurrent downloader for better performance
        const downloadStats = await this.concurrentDownloader.downloadImages(
          images,
          postDir,
          (msg) => console.log(`    ${msg}`),
          (stats) => {
            this.stats.imagesDownloaded += stats.completed;
            this.stats.errors += stats.failed;
            console.log(`  📊 Batch complete: ${stats.completed} downloaded, ${stats.skipped} skipped, ${stats.failed} failed`);
          }
        );

        this.stats.postsDownloaded++;
        console.log(`  ✅ Post ${post.id} completed - saved to ${postDir}`);
        return;
      }
    }

    // Fallback to API if HTML fetch failed or found no images
    console.log(`  ⚠️  HTML fetch failed or found no images, trying API fallback...`);
    const postData = await fetchPostFromAPI(post, (msg) => console.log(`    ${msg}`));

    // If we have post data, do a thorough check including image verification
    if (postData) {
      const thoroughCheck = await isPostAlreadyDownloaded(postDir, postData);
      if (thoroughCheck.downloaded) {
        console.log(`  ⏭️  Skipping: Post already fully downloaded with all ${extractImagesFromPostData(postData).length} images verified`);
        this.stats.postsSkipped++;
        return;
      } else if (thoroughCheck.missingImages && thoroughCheck.missingImages.length > 0) {
        console.log(`  🔄 Resuming: Missing ${thoroughCheck.missingImages.length} images - ${thoroughCheck.reason}`);
      }

      console.log(`  ✅ Got post data from API`);

      // Save post metadata as JSON
      await savePostMetadata(postDir, postData);
      console.log(`  💾 Saved post metadata`);

      // Extract and download images from API data using concurrent downloader
      const images = extractImagesFromPostData(postData);
      console.log(`  🖼️  Found ${images.length} images to download from API`);

      if (images.length > 0) {
        const downloadStats = await this.concurrentDownloader.downloadImages(
          images,
          postDir,
          (msg) => console.log(`    ${msg}`),
          (stats) => {
            this.stats.imagesDownloaded += stats.completed;
            this.stats.errors += stats.failed;
            console.log(`  📊 Batch complete: ${stats.completed} downloaded, ${stats.skipped} skipped, ${stats.failed} failed`);
          }
        );

        // Verify all images were downloaded correctly after batch completion
        await this.verifyPostImages(postDir, images, post.id);
      }
    } else {
      console.log(`  ❌ Both HTML and API approaches failed for this post`);
    }

    this.stats.postsDownloaded++;
    console.log(`  ✅ Post ${post.id} completed - saved to ${postDir}`);
  }

  async processProfilesFile(filename) {
    try {
      console.log(`📂 Reading profiles from: ${filename}`);
      const profileUrls = await readProfilesFile(filename);

      console.log(`📋 Found ${profileUrls.length} profile URLs to process\n`);

      for (let i = 0; i < profileUrls.length; i++) {
        const profileUrl = profileUrls[i];
        console.log(`\n🔄 [${i + 1}/${profileUrls.length}] Processing profile: ${profileUrl}`);
        
        try {
          const posts = await this.getProfilePosts(profileUrl);
          
          if (posts.length === 0) {
            console.log(`  ⚠️  No posts found for this profile`);
            this.stats.profilesProcessed++;
            console.log(`  ✅ Profile completed`);
            continue;
          }

          for (let j = 0; j < posts.length; j++) {
            await this.downloadPost(posts[j], j, posts.length);
            
            // Show progress bar after each post
            const progress = ((j + 1) / posts.length * 100).toFixed(1);
            const completedBars = Math.floor((j + 1) / posts.length * 20);
            const remainingBars = 20 - completedBars;
            const progressBar = '█'.repeat(completedBars) + '░'.repeat(remainingBars);
            console.log(`  📊 Progress: [${progressBar}] ${j + 1}/${posts.length} (${progress}%)`);
          }
          
          this.stats.profilesProcessed++;
          console.log(`  ✅ Profile completed`);
        } catch (error) {
          this.stats.errors++;
          console.error(`  ❌ Error processing profile: ${error.message}`);
          console.log(`  ⏭️  Continuing with next profile...`);
        }
      }

      this.printSummary();
    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error processing profiles file: ${error.message}`);
    }
  }

  async verifyPostImages(postDir, expectedImages, postId) {
    console.log(`  🔍 Verifying ${expectedImages.length} images for post ${postId}...`);
    
    try {
      const verification = await verifyAllImagesDownloaded(postDir, expectedImages);
      
      if (verification.allPresent) {
        console.log(`  ✅ Verification passed: All ${verification.presentCount}/${verification.totalExpected} images verified`);
      } else {
        console.log(`  ⚠️  Verification issues found:`);
        console.log(`      📊 Present: ${verification.presentCount}/${verification.totalExpected}`);
        
        if (verification.missingFiles.length > 0) {
          console.log(`      ❌ Missing files (${verification.missingFiles.length}):`);
          verification.missingFiles.slice(0, 5).forEach(file => {
            console.log(`         • ${file}`);
          });
          if (verification.missingFiles.length > 5) {
            console.log(`         ... and ${verification.missingFiles.length - 5} more`);
          }
        }
        
        if (verification.corruptedFiles.length > 0) {
          console.log(`      🔧 Corrupted files (${verification.corruptedFiles.length}):`);
          verification.corruptedFiles.slice(0, 5).forEach(file => {
            console.log(`         • ${file.name} (${file.reason})`);
          });
          if (verification.corruptedFiles.length > 5) {
            console.log(`         ... and ${verification.corruptedFiles.length - 5} more`);
          }
        }
        
        // Update stats to reflect verification issues
        this.stats.errors += verification.missingCount;
      }
    } catch (error) {
      console.log(`  ❌ Verification failed: ${error.message}`);
      this.stats.errors++;
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 DOWNLOAD SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Profiles processed: ${this.stats.profilesProcessed}`);
    console.log(`📄 Posts downloaded: ${this.stats.postsDownloaded}`);
    console.log(`⏭️  Posts skipped: ${this.stats.postsSkipped}`);
    console.log(`🖼️  Images downloaded: ${this.stats.imagesDownloaded}`);
    console.log(`❌ Errors encountered: ${this.stats.errors}`);
    console.log('='.repeat(50));
    
    if (this.stats.errors === 0) {
      console.log('🎉 All downloads completed successfully!');
    } else {
      console.log('⚠️  Some errors occurred during download. Check logs above.');
    }
  }
}

module.exports = KemonoDownloader;