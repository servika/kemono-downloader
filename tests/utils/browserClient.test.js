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
    expect(mockPage.goto).toHaveBeenCalledWith('https://kemono.cr/', expect.any(Object));
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

  test('fetchRenderedPage should return HTML content', async () => {
    const onLog = jest.fn();
    const result = await browserClient.fetchRenderedPage('https://example.com/page', onLog);

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/page', expect.any(Object));
    expect(mockPage.content).toHaveBeenCalled();
    expect(result).toBe('<html></html>');
    expect(delay).toHaveBeenCalledWith(3000);
  });

  test('extractImagesFromRenderedPost should return extracted URLs', async () => {
    mockPage.evaluate.mockResolvedValue(['https://example.com/a.jpg', 'https://example.com/b.png']);

    const result = await browserClient.extractImagesFromRenderedPost('https://example.com/post');

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/post', expect.any(Object));
    expect(delay).toHaveBeenCalledWith(3000);
    expect(result).toEqual(['https://example.com/a.jpg', 'https://example.com/b.png']);
  });

  test('extractImagesFromRenderedPost should return empty list on error', async () => {
    mockPage.evaluate.mockRejectedValue(new Error('Eval error'));

    const result = await browserClient.extractImagesFromRenderedPost('https://example.com/post');

    expect(result).toEqual([]);
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
