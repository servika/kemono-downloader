const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const { delay } = require('./utils/delay');
const { extractUserInfo } = require('./utils/urlUtils');
const { getImageName } = require('./utils/urlUtils');
const { downloadImage, savePostMetadata, saveHtmlContent, readProfilesFile } = require('./utils/fileUtils');
const { fetchPage, fetchPostsFromAPI, fetchPostFromAPI } = require('./api/kemonoApi');
const { extractImagesFromPostData, extractImagesFromHTML } = require('./extractors/imageExtractor');
const { isPostAlreadyDownloaded, getDownloadStatus, verifyAllImagesDownloaded } = require('./utils/downloadChecker');
const ConcurrentDownloader = require('./utils/concurrentDownloader');
const config = require('./utils/config');

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
    console.log(`📁 Base directory: ${this.baseDir}`);
    console.log(`⚡ Max concurrent images: ${config.getMaxConcurrentImages()}`);
    console.log(`⏱️  Image delay: ${config.getImageDelay()}ms`);
  }

  async getProfilePosts(profileUrl) {
    console.log(`  🔍 Analyzing profile for posts...`);
    const userInfo = extractUserInfo(profileUrl);
    
    // Try API first, then fallback to HTML scraping
    console.log(`  🔌 Trying API endpoint for user ${userInfo.userId}...`);
    const apiPosts = await fetchPostsFromAPI(userInfo.service, userInfo.userId, (msg) => console.log(`    ${msg}`));
    
    if (apiPosts.length > 0) {
      console.log(`  ✅ Found ${apiPosts.length} posts via API`);
      return apiPosts;
    }
    
    console.log(`  ⚠️  API failed, trying HTML scraping fallback...`);
    return await this.getProfilePostsFromHTML(profileUrl);
  }

  async getProfilePostsFromHTML(profileUrl) {
    const html = await fetchPage(profileUrl, (msg) => console.log(`  ${msg}`));
    if (!html) {
      console.log(`  ❌ Could not load profile page`);
      return [];
    }

    const $ = cheerio.load(html);
    const posts = [];
    const userInfo = extractUserInfo(profileUrl);

    // Extract username from page
    const username = $('.user-header__info span[itemprop="name"]').text().trim() || 
                    $('.user-header__profile h1').text().trim() || 
                    $('h1').first().text().trim() || 
                    `user_${userInfo.userId}`;

    console.log(`  👤 Found user: ${username}`);

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

    console.log(`  🔍 Debug: HTML length: ${html.length} characters`);
    console.log(`  🔍 Debug: All links count: ${$('a').length}`);
    
    // Try multiple selectors to find posts
    const postSelectors = [
      'article.post-card',
      '.post-card', 
      'article',
      '.card',
      '[href*="/post/"]',
      'a[href*="/post/"]'
    ];

    let postsFound = false;

    for (const selector of postSelectors) {
      const elements = $(selector);
      
      if (elements.length > 0) {
        console.log(`  🔍 Found ${elements.length} elements with selector: ${selector}`);
        elements.each((index, element) => {
          const $element = $(element);
          
          // Try different ways to find post links
          let postLink = null;
          
          if ($element.is('a')) {
            postLink = $element.attr('href');
          } else {
            postLink = $element.find('a').first().attr('href') || 
                      $element.find('[href*="/post/"]').first().attr('href');
          }
          
          if (postLink && postLink.includes('/post/')) {
            const fullPostUrl = postLink.startsWith('http') ? postLink : `https://kemono.su${postLink}`;
            const postId = this.extractPostId(fullPostUrl);
            
            posts.push({
              url: fullPostUrl,
              id: postId,
              username: username.replace(/[<>:"/\\|?*]/g, '_') // Sanitize filename
            });
            postsFound = true;
          }
        });
        
        if (postsFound) {
          console.log(`  ✅ Successfully found posts using selector: ${selector}`);
          break;
        }
      }
    }

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

    // Try to get post content from API first
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
    }
    
    if (postData) {
      console.log(`  ✅ Got post data from API`);
      
      // Save post metadata as JSON
      await savePostMetadata(postDir, postData);
      console.log(`  💾 Saved post metadata`);
      
      // Extract and download images from API data using concurrent downloader
      const images = extractImagesFromPostData(postData);
      console.log(`  🖼️  Found ${images.length} images to download`);
      
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
      console.log(`  ⚠️  API failed, trying HTML fallback...`);
      
      const html = await fetchPage(post.url, (msg) => console.log(`  ${msg}`));
      if (!html) {
        console.log(`  ❌ Skipping post due to fetch failure`);
        return;
      }

      const $ = cheerio.load(html);
      
      // Save HTML content
      await saveHtmlContent(postDir, html);
      console.log(`  💾 Saving HTML content...`);

      // Check if this is SPA content
      const bodyText = $('body').text();
      if (bodyText.includes('System.import') || bodyText.includes('vite-legacy-entry')) {
        console.log(`  ⚠️  Post page is also a SPA - no images can be extracted from HTML`);
        console.log(`  💡 Content is loaded dynamically. API method needed for images.`);
      } else {
        // Try to extract images from HTML (fallback)
        const images = extractImagesFromHTML($);
        console.log(`  🖼️  Found ${images.length} images to download`);
        
        for (let i = 0; i < images.length; i++) {
          const imageUrl = images[i];
          const imageName = getImageName(imageUrl, i);
          const imagePath = path.join(postDir, imageName);
          
          try {
            await downloadImage(imageUrl, imagePath, (msg) => console.log(`    ${msg}`));
            this.stats.imagesDownloaded++;
            // Small delay between image downloads
            await delay(200);
          } catch (error) {
            this.stats.errors++;
            console.log(`    ⚠️  Continuing with next image...`);
          }
        }
      }
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