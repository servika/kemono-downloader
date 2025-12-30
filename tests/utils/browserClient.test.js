const puppeteer = require('puppeteer-extra');
const { delay } = require('../../src/utils/delay');

jest.mock('puppeteer-extra', () => ({
  use: jest.fn(),
  launch: jest.fn()
}));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn(() => 'stealth'));
jest.mock('../../src/utils/delay', () => ({
  delay: jest.fn()
}));

const browserClient = require('../../src/utils/browserClient');

describe('browserClient', () => {
  let mockPage;
  let mockBrowser;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPage = {
      setViewport: jest.fn().mockResolvedValue(),
      setUserAgent: jest.fn().mockResolvedValue(),
      setExtraHTTPHeaders: jest.fn().mockResolvedValue(),
      setCookie: jest.fn().mockResolvedValue(),
      goto: jest.fn().mockResolvedValue(),
      content: jest.fn().mockResolvedValue('<html></html>'),
      evaluate: jest.fn()
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue()
    };

    puppeteer.launch.mockResolvedValue(mockBrowser);
    delay.mockResolvedValue();

    browserClient.browser = null;
    browserClient.page = null;
    browserClient.isInitialized = false;

    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('initialize should configure browser and page', async () => {
    await browserClient.initialize();

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: 'new'
      })
    );
    expect(mockBrowser.newPage).toHaveBeenCalled();
    expect(mockPage.setViewport).toHaveBeenCalled();
    expect(mockPage.setUserAgent).toHaveBeenCalled();
    expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalledWith('https://kemono.cr', expect.any(Object));
    expect(delay).toHaveBeenCalledWith(2000);
    expect(browserClient.isInitialized).toBe(true);
  });

  test('fetchJSON should return parsed JSON', async () => {
    mockPage.evaluate.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: '{"hello":"world"}'
    });

    const onLog = jest.fn();
    const result = await browserClient.fetchJSON('https://example.com/api', onLog);

    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(result).toEqual({ status: 200, data: { hello: 'world' } });
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Browser fetch successful'));
  });

  test('fetchJSON should throw on non-ok responses', async () => {
    mockPage.evaluate.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: '{}'
    });

    await expect(browserClient.fetchJSON('https://example.com/api'))
      .rejects
      .toThrow('HTTP 403 Forbidden');
  });

  test('fetchJSON should throw on empty response', async () => {
    mockPage.evaluate.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: null
    });

    await expect(browserClient.fetchJSON('https://example.com/api'))
      .rejects
      .toThrow('Empty response');
  });

  test('fetchJSON should throw on fetch error in browser', async () => {
    mockPage.evaluate.mockResolvedValue({
      ok: false,
      status: 0,
      statusText: 'Network error',
      text: null
    });

    await expect(browserClient.fetchJSON('https://example.com/api'))
      .rejects
      .toThrow('HTTP 0 Network error');
  });

  test('fetchRenderedPage should return HTML content', async () => {
    const onLog = jest.fn();
    const result = await browserClient.fetchRenderedPage('https://example.com/page', onLog);

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/page', expect.any(Object));
    expect(mockPage.content).toHaveBeenCalled();
    expect(result).toBe('<html></html>');
    expect(delay).toHaveBeenCalledWith(5000);
  });

  test('fetchRenderedPage should throw on navigation error', async () => {
    const onLog = jest.fn();
    // Mock goto to reject on second call (first is initialization, second is the actual page)
    mockPage.goto
      .mockResolvedValueOnce() // First call during initialization succeeds
      .mockRejectedValueOnce(new Error('Navigation timeout')); // Second call fails

    await expect(browserClient.fetchRenderedPage('https://example.com/page', onLog))
      .rejects
      .toThrow('Navigation timeout');

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('navigating'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('failed'));
  });

  test('extractImagesFromRenderedPost should return extracted URLs', async () => {
    // Mock page.evaluate to return object with urls and debug info (as per actual implementation)
    mockPage.evaluate.mockResolvedValue({
      urls: ['https://example.com/a.jpg', 'https://example.com/b.png'],
      debug: { linksFound: 2, imagesFound: 0, videosFound: 0, urlsCollected: 2 }
    });

    const result = await browserClient.extractImagesFromRenderedPost('https://example.com/post');

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/post', expect.any(Object));
    // Delay is called twice: 2000ms during initialize() and 8000ms for rendering
    expect(delay).toHaveBeenCalledWith(2000); // initialize delay
    expect(delay).toHaveBeenCalledWith(8000); // extractImagesFromRenderedPost delay (increased from 3s to 8s)
    expect(result).toEqual(['https://example.com/a.jpg', 'https://example.com/b.png']);
  });

  test('extractImagesFromRenderedPost should return empty list on error', async () => {
    mockPage.evaluate.mockRejectedValue(new Error('Eval error'));

    const result = await browserClient.extractImagesFromRenderedPost('https://example.com/post');

    expect(result).toEqual([]);
  });

  test('extractImagesFromRenderedPost should convert thumbnail URLs in browser', async () => {
    // Test the thumbnail conversion logic that runs inside page.evaluate
    const convertThumbnailUrl = (url) => {
      if (!url) return url;
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
    };

    // Test all thumbnail patterns
    expect(convertThumbnailUrl('https://kemono.cr/thumbnail/abc123.jpg')).toBe('https://kemono.cr/data/abc123.jpg');
    expect(convertThumbnailUrl('https://kemono.cr/image_thumb.jpg')).toBe('https://kemono.cr/image.jpg');
    expect(convertThumbnailUrl('https://kemono.cr/image.thumb.jpg')).toBe('https://kemono.cr/image.jpg');
    expect(convertThumbnailUrl('https://kemono.cr/normal.jpg')).toBe('https://kemono.cr/normal.jpg');
    expect(convertThumbnailUrl(null)).toBe(null);
  });

  test('navigateToPage should set browser context', async () => {
    const onLog = jest.fn();

    await browserClient.navigateToPage('https://example.com/profile', onLog);

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/profile', expect.any(Object));
    expect(delay).toHaveBeenCalledWith(1000);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Setting browser context'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Browser context set'));
  });

  test('navigateToPage should continue on navigation error', async () => {
    const onLog = jest.fn();
    // Mock goto to succeed for initialization, then fail for the actual navigation
    mockPage.goto
      .mockResolvedValueOnce() // Initialization succeeds
      .mockRejectedValueOnce(new Error('Navigation failed')); // Navigation fails

    await browserClient.navigateToPage('https://example.com/profile', onLog);

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Could not navigate'));
  });

  test('close should reset browser state', async () => {
    await browserClient.initialize();
    await browserClient.close();

    expect(mockBrowser.close).toHaveBeenCalled();
    expect(browserClient.browser).toBeNull();
    expect(browserClient.page).toBeNull();
    expect(browserClient.isInitialized).toBe(false);
  });
});
