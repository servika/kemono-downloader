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
    if (cookies.session) {
      console.log('🍪 Setting authentication cookies...');
      await this.page.setCookie({
        name: 'session',
        value: cookies.session,
        domain: domain,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      });
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
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
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

      // Navigate to the page
      await this.page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: 45000
      });

      // Wait for potential JavaScript rendering
      await delay(3000);

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

      // Wait for JavaScript to render images
      await delay(3000);

      // Extract image and video URLs from the rendered page
      const mediaUrls = await this.page.evaluate(() => {
        const urls = [];

        // Find all image elements
        const images = document.querySelectorAll('img.fileThumb, img.post__image, img[data-src], article img, .post__files img, .post__attachment img');
        images.forEach(img => {
          const src = img.src || img.dataset.src || img.getAttribute('data-src');
          if (src && !src.includes('icon') && !src.includes('avatar') && !src.includes('logo')) {
            urls.push(src);
          }
        });

        // Find all video elements
        const videos = document.querySelectorAll('video source, video');
        videos.forEach(video => {
          const src = video.src || video.dataset.src || video.getAttribute('data-src');
          if (src) {
            urls.push(src);
          }
        });

        // Find all download links
        const links = document.querySelectorAll('a.post__attachment-link, a.fileThumb, a[download], a[href*=".jpg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"], a[href*=".mp4"], a[href*=".webm"]');
        links.forEach(link => {
          const href = link.href;
          if (href && !urls.includes(href)) {
            urls.push(href);
          }
        });

        // Remove duplicates
        return [...new Set(urls)];
      });

      if (onLog) onLog(`✅ Extracted ${mediaUrls.length} media URLs from rendered page`);

      return mediaUrls;

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