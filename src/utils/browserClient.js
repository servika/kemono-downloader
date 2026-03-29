const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { delay } = require('./delay');
const config = require('./config');

puppeteer.use(StealthPlugin());

/**
 * Browser client for bypassing Cloudflare and anti-bot protection
 * Uses Puppeteer with stealth mode to make API requests
 */

class BrowserClient {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    console.log('🌐 Launching headless browser...');

    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    this.page = await this.browser.newPage();

    // Set realistic viewport and user agent
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Set extra headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    // Get the base URL from config
    const baseUrl = config.getBaseUrl();
    const domain = new URL(baseUrl).hostname;

    // Set authentication cookies from config
    const cookies = config.getCookies();
    const cookieEntries = Object.entries(cookies || {}).filter(([, value]) => value);
    if (cookieEntries.length > 0) {
      console.log(`🍪 Setting ${cookieEntries.length} authentication cookie(s)...`);
      for (const [name, value] of cookieEntries) {
        await this.page.setCookie({
          name,
          value: String(value),
          domain: domain,
          path: '/'
        });
      }
    }

    // Visit the main page first to establish session
    console.log(`🔑 Establishing session with ${domain}...`);
    await this.page.goto(baseUrl, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Wait a bit to let any challenges complete
    await delay(2000);

    this.isInitialized = true;
    console.log('✅ Browser ready');
  }

  async navigateToPage(url, onLog) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      if (onLog) onLog(`🔗 Setting browser context: ${url}`);

      // Navigate to the page to establish proper browser context
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Small delay to let the session establish
      await delay(1000);

      if (onLog) onLog(`✅ Browser context set`);
    } catch (error) {
      if (onLog) onLog(`⚠️  Could not navigate to page (continuing anyway): ${error.message}`);
      // Don't throw - we can still try to make API requests
    }
  }

  async fetchJSON(url, onLog) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      if (onLog) onLog(`🌐 Browser fetching: ${url}`);

      // Use fetch() from within the browser context instead of page.goto()
      // This allows us to make API calls with full browser session/cookies
      const result = await this.page.evaluate(async (apiUrl) => {
        try {
          // Parse URL to get base URL for referrer
          const urlObj = new URL(apiUrl);
          const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
          const pathWithoutQuery = `${baseUrl}${urlObj.pathname}`;

          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Referer': pathWithoutQuery,
              'Origin': baseUrl,
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin'
            },
            credentials: 'same-origin'
          });

          const text = await response.text();

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            text: text
          };
        } catch (err) {
          return {
            ok: false,
            status: 0,
            statusText: err.message,
            text: null
          };
        }
      }, url);

      if (!result.ok) {
        throw new Error(`HTTP ${result.status} ${result.statusText}`);
      }

      if (!result.text) {
        throw new Error('Empty response');
      }

      if (onLog) onLog(`✅ Browser fetch successful (${result.text.length} chars)`);

      // Parse and return JSON
      const data = JSON.parse(result.text);

      return {
        status: result.status,
        data: data
      };

    } catch (error) {
      if (onLog) onLog(`❌ Browser fetch failed: ${error.message}`);
      throw error;
    }
  }

  async fetchRenderedPage(url, onLog) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      if (onLog) onLog(`🌐 Browser navigating to: ${url}`);

      // Navigate to the page with less strict waiting condition
      // Use 'load' instead of 'networkidle0' to avoid timeout on slow pages
      await this.page.goto(url, {
        waitUntil: 'load',
        timeout: 60000
      });

      // Wait for potential JavaScript rendering and dynamic content
      await delay(5000);

      // Get the rendered HTML
      const html = await this.page.content();

      if (onLog) onLog(`✅ Page rendered (${html.length} chars)`);

      return html;

    } catch (error) {
      if (onLog) onLog(`❌ Browser navigation failed: ${error.message}`);
      throw error;
    }
  }

  async extractImagesFromRenderedPost(url, onLog) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      if (onLog) onLog(`🌐 Browser rendering post for image extraction: ${url}`);

      // Try progressive navigation strategies for SPAs
      let navigationSucceeded = false;
      let strategyUsed = '';

      // Strategy 1: Try networkidle2 (allows up to 2 connections) with 30s timeout
      try {
        await this.page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        navigationSucceeded = true;
        strategyUsed = 'networkidle2';
      } catch (e1) {
        if (onLog) onLog(`   ⚠️  networkidle2 timed out, trying 'load' strategy...`);

        // Strategy 2: Fall back to 'load' event (faster, less strict)
        try {
          await this.page.goto(url, {
            waitUntil: 'load',
            timeout: 20000
          });
          navigationSucceeded = true;
          strategyUsed = 'load';
        } catch (e2) {
          if (onLog) onLog(`   ⚠️  'load' failed, trying 'domcontentloaded'...`);

          // Strategy 3: Last resort - just wait for DOM
          await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });
          navigationSucceeded = true;
          strategyUsed = 'domcontentloaded';
        }
      }

      if (onLog && navigationSucceeded) onLog(`   ✅ Navigation succeeded using '${strategyUsed}' strategy`);

      // Wait longer for JavaScript to render images (increased from 3s to 8s)
      await delay(8000);

      // Debug: Save rendered HTML to file for inspection
      const debugMode = config.get('logging.debugBrowserExtraction', false);
      if (debugMode) {
        const fs = require('fs-extra');
        const path = require('path');
        const html = await this.page.content();
        const debugDir = path.join(process.cwd(), 'debug');
        await fs.ensureDir(debugDir);
        const postId = url.split('/').pop();
        await fs.writeFile(path.join(debugDir, `post-${postId}-rendered.html`), html);
        if (onLog) onLog(`   🐛 Saved rendered HTML to debug/post-${postId}-rendered.html`);
      }

      // Extract image and video URLs from the rendered page
      const mediaResult = await this.page.evaluate(() => {
        const items = [];
        const seenUrls = new Set();
        // Track img elements that are children of captured <a> links to avoid duplicate preview downloads
        const capturedImgElements = new Set();

        function isIgnoredUrl(url) {
          return !url || url.includes('icon') || url.includes('avatar') || url.includes('logo');
        }

        function addItem(url, filename) {
          if (isIgnoredUrl(url) || seenUrls.has(url)) return;
          seenUrls.add(url);
          items.push({ url, filename: filename || null });
        }

        // Priority 1: Find all download links (these are full-size files)
        // Include RAW camera formats (.nef, .cr2, .arw, .dng, .tif, .tiff) and generic binary (.bin)
        const links = document.querySelectorAll(
          'a.post__attachment-link, a.fileThumb, a[download], a[href*="/data/"], ' +
          'a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"], a[href*=".avif"], a[href*=".bmp"], ' +
          'a[href*=".mp4"], a[href*=".webm"], a[href*=".mov"], a[href*=".mkv"], a[href*=".avi"], ' +
          'a[href*=".psd"], a[href*=".clip"], a[href*=".pdf"], ' +
          'a[href*=".mp3"], a[href*=".flac"], a[href*=".wav"], a[href*=".ogg"], ' +
          'a[href*=".zip"], a[href*=".rar"], a[href*=".7z"], ' +
          'a[href*=".nef"], a[href*=".cr2"], a[href*=".cr3"], a[href*=".arw"], a[href*=".dng"], a[href*=".raf"], a[href*=".orf"], a[href*=".rw2"], a[href*=".pef"], ' +
          'a[href*=".tif"], a[href*=".tiff"], a[href*=".bin"]'
        );
        links.forEach(link => {
          const href = link.href;
          if (href && !isIgnoredUrl(href)) {
            // Capture the download attribute which contains the original filename (e.g., "photo.nef")
            const downloadAttr = link.getAttribute('download');
            addItem(href, downloadAttr || null);

            // Mark child <img> elements so we don't re-add them as separate preview downloads
            const childImgs = link.querySelectorAll('img');
            childImgs.forEach(img => capturedImgElements.add(img));
          }
        });

        // Priority 2: Find image elements (only those NOT already covered by download links)
        const images = document.querySelectorAll('img.post__image, img[data-src], article img, .post__files img, .post__attachment img');
        images.forEach(img => {
          // Skip images that are children of already-captured <a> links
          if (capturedImgElements.has(img)) return;

          let src = img.src || img.dataset.src || img.getAttribute('data-src');
          if (src && !isIgnoredUrl(src)) {
            // Skip thumbnail/preview URLs when we already have the full file from Priority 1
            // These are server-converted previews (e.g., .tif for .nef files) and not the originals
            if (src.includes('/thumbnail/') || src.includes('img.kemono.cr/thumbnail')) {
              return;
            }
            addItem(src, null);
          }
        });

        // Priority 3: Find video elements
        const videos = document.querySelectorAll('video source, video');
        videos.forEach(video => {
          const src = video.src || video.dataset.src || video.getAttribute('data-src');
          if (src) {
            addItem(src, null);
          }
        });

        // Debug: Log what we found
        const debug = {
          linksFound: links.length,
          imagesFound: images.length,
          videosFound: videos.length,
          itemsCollected: items.length
        };

        return { items, debug };
      });

      if (onLog) {
        onLog(`✅ Extracted ${mediaResult.items.length} media URLs from rendered page`);
        if (mediaResult.items.length === 0) {
          onLog(`   🔍 Debug: Found ${mediaResult.debug.linksFound} links, ${mediaResult.debug.imagesFound} images, ${mediaResult.debug.videosFound} videos`);
        }
      }

      // Return objects with {url, filename} so downstream code preserves original filenames
      return mediaResult.items;

    } catch (error) {
      if (onLog) onLog(`❌ Failed to extract images: ${error.message}`);
      return [];
    }
  }

  async close() {
    if (this.browser) {
      console.log('🔒 Closing browser...');
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isInitialized = false;
    }
  }
}

// Singleton instance
const browserClient = new BrowserClient();

// Cleanup on process exit
process.on('exit', () => {
  if (browserClient.browser) {
    browserClient.close();
  }
});

process.on('SIGINT', async () => {
  await browserClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await browserClient.close();
  process.exit(0);
});

module.exports = browserClient;
