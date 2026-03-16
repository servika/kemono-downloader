const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const { delay } = require('./utils/delay');
const { extractUserInfo, extractProfileName } = require('./utils/urlUtils');
const { getImageName } = require('./utils/urlUtils');
const { downloadImage, savePostMetadata, saveHtmlContent, readProfilesFile } = require('./utils/fileUtils');
const { fetchPage, fetchPostsFromAPI, fetchPostFromAPI } = require('./api/kemonoApi');
const { extractImagesFromPostData, extractImagesFromHTML } = require('./extractors/imageExtractor');
const { extractPostsFromProfileHTML, extractMediaFromPostHTML, extractPostMetadataFromHTML, extractUsernameFromProfile, extractExternalLinks } = require('./extractors/htmlParser');
const { isPostAlreadyDownloaded, getDownloadStatus, verifyAllImagesDownloaded } = require('./utils/downloadChecker');
const ConcurrentDownloader = require('./utils/concurrentDownloader');
const config = require('./utils/config');
const browserClient = require('./utils/browserClient');
const { downloadMegaLink, formatBytes } = require('./utils/megaDownloader');
const { downloadGoogleDriveLink, formatBytes: formatBytesGDrive } = require('./utils/googleDriveDownloader');
const { downloadDropboxLink, formatBytes: formatBytesDropbox } = require('./utils/dropboxDownloader');
const ProfileStateManager = require('./utils/profileStateManager');
const CompletedProfilesRegistry = require('./utils/completedProfilesRegistry');
const ProfileFileManager = require('./utils/profileFileManager');

class KemonoDownloader {
  constructor() {
    this.baseDir = config.getBaseDirectory();
    this.inProgressDir = path.join(this.baseDir, 'in-progress');
    this.completedDir = path.join(this.baseDir, 'completed');
    this.registry = new CompletedProfilesRegistry(path.join(this.baseDir, 'completed-profiles.json'));
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
    this.inProgressDir = path.join(this.baseDir, 'in-progress');
    this.completedDir = path.join(this.baseDir, 'completed');
    this.registry = new CompletedProfilesRegistry(path.join(this.baseDir, 'completed-profiles.json'));
    await this.registry.load();
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
    const allPosts = [];
    const userInfo = extractUserInfo(profileUrl);
    let offset = 0;
    let pageNum = 1;
    let consecutiveEmptyPages = 0;
    let username = null;

    // Pagination loop - kemono.cr uses ?o=offset for pagination (50 posts per page)
    while (true) {
      // Build URL with offset for pagination
      const pageUrl = offset === 0
        ? profileUrl
        : `${profileUrl}?o=${offset}`;

      if (pageNum > 1) {
        console.log(`  📄 Fetching page ${pageNum} (offset ${offset})...`);
      }

      const html = await fetchPage(pageUrl, (msg) => console.log(`  ${msg}`));
      if (!html) {
        console.log(`  ❌ Could not load profile page ${pageNum}`);
        break;
      }

      const $ = cheerio.load(html);

      // Check if this is a SPA (Single Page Application) - only on first page
      if (pageNum === 1) {
        const bodyText = $('body').text().substring(0, 500);
        if (bodyText.includes('System.import') || bodyText.includes('vite-legacy-entry')) {
          console.log(`  ⚠️  Detected SPA - content loaded dynamically via JavaScript`);
          console.log(`  💡 This site requires JavaScript to load posts. Consider:`);
          console.log(`     1. Check if the user has posts (visit the URL manually)`);
          console.log(`     2. The site may have moved or changed structure`);
          console.log(`     3. API endpoints may have changed`);
          return [];
        }
      }

      // Use enhanced HTML parser to extract posts from this page
      const pagePosts = extractPostsFromProfileHTML($, pageUrl);

      // Debug: Check for error messages or blocks if no posts found
      if (pagePosts.length === 0 && pageNum > 1) {
        const bodyText = $('body').text().toLowerCase();
        const pageTitle = $('title').text();

        console.log(`  🔍 Debug: Page ${pageNum} returned 0 posts - investigating...`);
        console.log(`      Page title: ${pageTitle}`);

        if (bodyText.includes('captcha') || bodyText.includes('verify you are human')) {
          console.log(`      ⚠️  Captcha detected on page ${pageNum}`);
        }
        if (bodyText.includes('rate limit') || bodyText.includes('too many requests')) {
          console.log(`      ⚠️  Rate limiting detected on page ${pageNum}`);
        }
        if (bodyText.includes('403') || bodyText.includes('forbidden')) {
          console.log(`      ⚠️  403 Forbidden on page ${pageNum}`);
        }
        if (bodyText.includes('404') || bodyText.includes('not found')) {
          console.log(`      ⚠️  404 Not Found on page ${pageNum}`);
        }

        // Check how many article elements exist at all
        const articleCount = $('article').length;
        const linkCount = $('a[href*="/post/"]').length;
        console.log(`      HTML stats: ${articleCount} <article> elements, ${linkCount} post links`);
      }

      // Extract username from first page
      if (pageNum === 1) {
        username = extractUsernameFromProfile($, profileUrl);
        console.log(`  👤 Found user: ${username}`);
      }

      // Track existing post IDs to avoid duplicates
      const existingIds = new Set(allPosts.map(p => p.id));
      let newPostsCount = 0;

      // Add new posts (avoiding duplicates)
      pagePosts.forEach(post => {
        if (!existingIds.has(post.id)) {
          post.username = username;
          allPosts.push(post);
          newPostsCount++;
        }
      });

      if (newPostsCount === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          console.log(`  📄 No new posts found on page ${pageNum} - stopping pagination`);
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        if (pageNum > 1) {
          console.log(`  ✅ Page ${pageNum}: Found ${newPostsCount} new posts (total: ${allPosts.length})`);
        }
      }

      // Safety limit to prevent infinite loops (allow up to 1000 pages = 50,000 posts)
      if (pageNum >= 1000) {
        console.log(`  ⚠️  Reached safety limit of 1000 pages (${allPosts.length} posts collected)`);
        console.log(`  ℹ️  If this is expected, the pagination will stop here to prevent infinite loops`);
        break;
      }

      // If we got less than 50 posts on this page, likely the last page
      if (pagePosts.length < 50) {
        console.log(`  📄 Page ${pageNum} returned ${pagePosts.length} posts (less than 50) - likely last page`);
        break;
      }

      // Move to next page
      offset += 50;
      pageNum++;

      // Add delay between pages to be respectful
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`  📋 Found ${allPosts.length} total posts across ${pageNum} page(s)`);
    return allPosts;
  }

  extractPostId(postUrl) {
    const urlParts = postUrl.split('/');
    return urlParts[urlParts.length - 1] || 'unknown';
  }

  async downloadPost(post, postIndex, totalPosts) {
    console.log(`\n📄 [${postIndex + 1}/${totalPosts}] Processing post: ${post.id}`);
    console.log(`  🔗 URL: ${post.url}`);

    const postDir = path.join(this.inProgressDir, post.username, post.id);

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

      // Extract external file hosting links (mega.nz, Google Drive, etc.)
      const externalLinks = extractExternalLinks($, post.url);
      if (externalLinks.length > 0) {
        console.log(`  🔗 Found ${externalLinks.length} external file hosting link(s):`);
        externalLinks.forEach(link => {
          console.log(`     • ${link.service}: ${link.text} - ${link.url}`);
        });

        // Save external links to a file
        const linksPath = path.join(postDir, 'external-links.json');
        await fs.writeFile(linksPath, JSON.stringify(externalLinks, null, 2));
        console.log(`  💾 Saved external links to external-links.json`);

        // Download mega.nz links automatically
        const megaLinks = externalLinks.filter(link => link.service === 'mega');
        if (megaLinks.length > 0) {
          console.log(`  🔗 Found ${megaLinks.length} mega.nz link(s) to download`);

          const megaDir = path.join(postDir, 'mega_downloads');

          for (const megaLink of megaLinks) {
            try {
              const stats = await downloadMegaLink(
                megaLink.url,
                megaDir,
                (msg) => console.log(`    ${msg}`)
              );

              this.stats.imagesDownloaded += stats.filesDownloaded;
              this.stats.errors += stats.filesFailed;

              console.log(`  ✅ MEGA download complete: ${stats.filesDownloaded} files, ${formatBytes(stats.totalSize)}`);
            } catch (error) {
              this.stats.errors++;
              console.log(`  ❌ MEGA download failed: ${error.message}`);
            }
          }
        }

        // Download Google Drive links automatically
        const googleDriveLinks = externalLinks.filter(link =>
          link.service === 'drive' || link.service === 'docs'
        );

        if (googleDriveLinks.length > 0) {
          console.log(`  🔗 Found ${googleDriveLinks.length} Google Drive link(s) to download`);

          const driveDir = path.join(postDir, 'google_drive_downloads');

          for (const driveLink of googleDriveLinks) {
            try {
              const stats = await downloadGoogleDriveLink(
                driveLink.url,
                driveDir,
                (msg) => console.log(`    ${msg}`)
              );

              this.stats.imagesDownloaded += stats.filesDownloaded;
              this.stats.errors += stats.filesFailed;

              if (stats.filesDownloaded > 0) {
                console.log(`  ✅ Google Drive download complete: ${stats.filesDownloaded} files, ${formatBytesGDrive(stats.totalSize)}`);
              }
            } catch (error) {
              this.stats.errors++;
              console.log(`  ❌ Google Drive download failed: ${error.message}`);
            }
          }
        }

        // Download Dropbox links automatically
        const dropboxLinks = externalLinks.filter(link => link.service === 'dropbox');
        if (dropboxLinks.length > 0) {
          console.log(`  🔗 Found ${dropboxLinks.length} Dropbox link(s) to download`);

          const dropboxDir = path.join(postDir, 'dropbox_downloads');

          for (const dropboxLink of dropboxLinks) {
            try {
              const stats = await downloadDropboxLink(
                dropboxLink.url,
                dropboxDir,
                (msg) => console.log(`    ${msg}`)
              );

              this.stats.imagesDownloaded += stats.filesDownloaded;
              this.stats.errors += stats.filesFailed;

              if (stats.filesDownloaded > 0) {
                console.log(`  ✅ Dropbox download complete: ${stats.filesDownloaded} files, ${formatBytesDropbox(stats.totalSize)}`);
              }
            } catch (error) {
              this.stats.errors++;
              console.log(`  ❌ Dropbox download failed: ${error.message}`);
            }
          }
        }
      }

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

        // Save HTML content AFTER downloading images so we can localize URLs
        await saveHtmlContent(postDir, html, images);
        console.log(`  💾 Saved HTML content with localized image paths`);

        this.stats.postsDownloaded++;
        console.log(`  ✅ Post ${post.id} completed - saved to ${postDir}`);
        return;
      } else {
        // No images, just save the HTML as-is
        await saveHtmlContent(postDir, html);
        console.log(`  💾 Saved HTML content`);
      }
    }

    // Fallback to API if HTML fetch failed or found no images
    const skipAPI = config.get('api.skipAPIFallback', false);
    if (skipAPI) {
      console.log(`  ⚠️  HTML fetch failed or found no images, API fallback disabled`);
      console.log(`  ❌ Both HTML and API approaches failed for this post`);
      this.stats.postsDownloaded++;
      console.log(`  ✅ Post ${post.id} completed - saved to ${postDir}`);
      return;
    }

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
      const profileFileManager = new ProfileFileManager(filename);
      const profileUrls = await profileFileManager.readProfiles();

      // Initialize ProfileStateManager for writing per-profile .download-state.json
      const stateManager = new ProfileStateManager(this.inProgressDir);

      // Show registry stats
      const registryEntries = await this.registry.getAll();
      const fileStats = await profileFileManager.getStatistics();
      console.log(`📋 Found ${profileUrls.length} active profile URLs to process`);
      console.log(`✅ ${registryEntries.length} profile(s) in completed registry`);
      console.log(`📝 ${fileStats.completed} profile(s) commented out in profiles.txt\n`);

      for (let i = 0; i < profileUrls.length; i++) {
        const profileUrl = profileUrls[i];
        console.log(`\n🔄 [${i + 1}/${profileUrls.length}] Processing profile: ${profileUrl}`);

        try {
          // Skip profiles already in the completed registry BEFORE fetching posts.
          // URL is the stable key — works even after moving the folder to an external drive.
          if (!config.shouldForceRedownload() && this.registry.isCompleted(profileUrl)) {
            const entry = (await this.registry.getAll()).find(e => e.profileUrl === profileUrl);
            console.log(`  ⏭️  Skipping: Profile found in completed registry`);
            if (entry) {
              console.log(`     Completed: ${entry.completedAt}`);
              console.log(`     Downloaded: ${entry.totalPosts} posts, ${entry.totalImages} images`);
            }
            this.stats.profilesProcessed++;
            continue;
          }

          const userInfo = extractUserInfo(profileUrl);
          const posts = await this.getProfilePosts(profileUrl);

          // Get username from first post or use fallback
          const username = posts.length > 0 ? posts[0].username : `${userInfo.service}_${userInfo.userId}`;

          if (posts.length === 0) {
            console.log(`  ⚠️  No posts found for this profile`);
            const completedAt = new Date().toISOString();
            await stateManager.markCompleted(username, {
              profileUrl, service: userInfo.service, userId: userInfo.userId,
              totalPosts: 0, totalImages: 0, totalErrors: this.stats.errors
            });
            await this._finalizeProfile(username, profileUrl, {
              service: userInfo.service, userId: userInfo.userId,
              totalPosts: 0, totalImages: 0, completedAt,
              profileFileManager
            });
            this.stats.profilesProcessed++;
            console.log(`  ✅ Profile completed`);
            continue;
          }

          // Track images for this profile
          const initialImages = this.stats.imagesDownloaded;
          const initialErrors = this.stats.errors;

          // Download all posts
          for (let j = 0; j < posts.length; j++) {
            await this.downloadPost(posts[j], j, posts.length);

            // Show progress bar after each post
            const progress = ((j + 1) / posts.length * 100).toFixed(1);
            const completedBars = Math.floor((j + 1) / posts.length * 20);
            const remainingBars = 20 - completedBars;
            const progressBar = '█'.repeat(completedBars) + '░'.repeat(remainingBars);
            console.log(`  📊 Progress: [${progressBar}] ${j + 1}/${posts.length} (${progress}%)`);
          }

          // Calculate stats for this profile
          const profileImages = this.stats.imagesDownloaded - initialImages;
          const profileErrors = this.stats.errors - initialErrors;

          const completedAt = new Date().toISOString();

          // Write .download-state.json into in-progress folder (before move)
          await stateManager.markCompleted(username, {
            profileUrl, service: userInfo.service, userId: userInfo.userId,
            totalPosts: posts.length, totalImages: profileImages, totalErrors: profileErrors
          });

          // Move folder, update registry, comment profiles.txt
          await this._finalizeProfile(username, profileUrl, {
            service: userInfo.service, userId: userInfo.userId,
            totalPosts: posts.length, totalImages: profileImages, completedAt,
            profileFileManager
          });

          this.stats.profilesProcessed++;
          console.log(`  ✅ Profile completed (${posts.length} posts, ${profileImages} images)`);
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

  /**
   * Move profile folder from in-progress/ to completed/, update the registry,
   * and comment out the URL in profiles.txt.
   */
  async _finalizeProfile(username, profileUrl, { service, userId, totalPosts, totalImages, completedAt, profileFileManager }) {
    // Move folder: in-progress/username → completed/username
    const srcDir  = path.join(this.inProgressDir, username);
    const destDir = path.join(this.completedDir, username);
    try {
      await fs.ensureDir(this.completedDir);
      if (await fs.pathExists(srcDir)) {
        if (await fs.pathExists(destDir)) {
          console.log(`  ⚠️  Destination already exists, skipping move: completed/${username}`);
        } else {
          await fs.move(srcDir, destDir);
          console.log(`  📦 Moved to completed/: ${username}`);
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to move profile folder: ${error.message}`);
    }

    // Update the flat registry (stays on disk even when folder is moved externally)
    await this.registry.markCompleted({ profileUrl, username, service, userId, totalPosts, totalImages, completedAt });

    // Comment out the URL in profiles.txt
    await profileFileManager.commentProfile(profileUrl, { postCount: totalPosts, timestamp: completedAt });
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