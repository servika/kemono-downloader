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

      // Navigate to the post page
      await this.page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: 45000
      });

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
      const mediaUrls = await this.page.evaluate(() => {
        const urls = [];

        // Helper function to convert thumbnail URLs to full URLs
        function convertThumbnailUrl(url) {
          if (!url) return url;

          // Replace thumbnail paths with full paths
          if (url.includes('/thumbnail/')) {
            url = url.replace('/thumbnail/', '/data/');
          }
          if (url.includes('_thumb.')) {
            url = url.replace('_thumb.', '.');
          }
          if (url.includes('.thumb.')) {
            url = url.replace('.thumb.', '.');
          }

          return url;
        }

        // Priority 1: Find all download links (these are full-size)
        const links = document.querySelectorAll('a.post__attachment-link, a.fileThumb, a[download], a[href*="/data/"], a[href*=".jpg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"], a[href*=".mp4"], a[href*=".webm"]');
        links.forEach(link => {
          const href = link.href;
          if (href && !href.includes('icon') && !href.includes('avatar') && !href.includes('logo')) {
            urls.push(href);
          }
        });

        // Priority 2: Find image elements and convert thumbnails
        const images = document.querySelectorAll('img.post__image, img[data-src], article img, .post__files img, .post__attachment img');
        images.forEach(img => {
          let src = img.src || img.dataset.src || img.getAttribute('data-src');
          if (src && !src.includes('icon') && !src.includes('avatar') && !src.includes('logo')) {
            // Convert thumbnail URL to full URL
            src = convertThumbnailUrl(src);

            // Only add if not already in list
            if (!urls.includes(src)) {
              urls.push(src);
            }
          }
        });

        // Priority 3: Find video elements
        const videos = document.querySelectorAll('video source, video');
        videos.forEach(video => {
          const src = video.src || video.dataset.src || video.getAttribute('data-src');
          if (src && !urls.includes(src)) {
            urls.push(src);
          }
        });

        // Debug: Log what we found
        const debug = {
          linksFound: links.length,
          imagesFound: images.length,
          videosFound: videos.length,
          urlsCollected: urls.length
        };

        // Remove duplicates
        return { urls: [...new Set(urls)], debug };
      });

      if (onLog) {
        onLog(`✅ Extracted ${mediaUrls.urls.length} media URLs from rendered page`);
        if (mediaUrls.urls.length === 0) {
          onLog(`   🔍 Debug: Found ${mediaUrls.debug.linksFound} links, ${mediaUrls.debug.imagesFound} images, ${mediaUrls.debug.videosFound} videos`);
        }
      }

      return mediaUrls.urls;

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
