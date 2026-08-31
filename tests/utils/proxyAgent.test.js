const config = require('../../src/utils/config');

jest.mock('../../src/utils/config');

const {
  DEFAULT_PROXY_HOSTS,
  getProxySettings,
  shouldUseProxy,
  getAxiosProxyOptions,
  getBrowserProxyArgs,
  describeProxy
} = require('../../src/utils/proxyAgent');

/** Makes config.get('network.proxy') return the given proxy section */
function mockProxy(proxy) {
  config.get.mockImplementation(key => (key === 'network.proxy' ? proxy : undefined));
}

const CDN_URL = 'https://n3.kemono.cr/data/ab/cd/file.jpg';
const SITE_URL = 'https://kemono.cr/api/v1/patreon/user/1/post/2';

describe('proxyAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProxySettings', () => {
    it('should report disabled when no proxy section exists', () => {
      mockProxy(undefined);
      expect(getProxySettings().enabled).toBe(false);
    });

    it('should report disabled when enabled is true but url is empty', () => {
      mockProxy({ enabled: true, url: '' });
      expect(getProxySettings().enabled).toBe(false);
    });

    it('should fall back to the default CDN host list', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      expect(getProxySettings().onlyHosts).toEqual(DEFAULT_PROXY_HOSTS);
    });

    it('should keep a custom host list', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: ['example.com'] });
      expect(getProxySettings().onlyHosts).toEqual(['example.com']);
    });
  });

  describe('shouldUseProxy', () => {
    it('should return false when the proxy is disabled', () => {
      mockProxy({ enabled: false, url: 'socks5://127.0.0.1:1080' });
      expect(shouldUseProxy(CDN_URL)).toBe(false);
    });

    it('should proxy default CDN hosts', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      expect(shouldUseProxy(CDN_URL)).toBe(true);
    });

    it('should not proxy the main site by default', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      expect(shouldUseProxy(SITE_URL)).toBe(false);
    });

    it('should proxy every host when onlyHosts is an empty array', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: [] });
      expect(shouldUseProxy(SITE_URL)).toBe(true);
      expect(shouldUseProxy('https://drive.google.com/file')).toBe(true);
    });

    it('should support wildcard host patterns', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: ['*.kemono.cr'] });
      expect(shouldUseProxy(CDN_URL)).toBe(true);
      expect(shouldUseProxy(SITE_URL)).toBe(true);
      expect(shouldUseProxy('https://example.com/x')).toBe(false);
    });

    it('should match hosts case-insensitively', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: ['N3.Kemono.CR'] });
      expect(shouldUseProxy(CDN_URL)).toBe(true);
    });

    it('should return false for malformed URLs', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: [] });
      expect(shouldUseProxy('not a url')).toBe(false);
    });
  });

  describe('getAxiosProxyOptions', () => {
    it('should return empty options for direct hosts', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      expect(getAxiosProxyOptions(SITE_URL)).toEqual({});
    });

    it('should return SOCKS agents for proxied hosts', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      const options = getAxiosProxyOptions(CDN_URL);
      expect(options.proxy).toBe(false);
      expect(options.httpsAgent.constructor.name).toBe('SocksProxyAgent');
    });

    it('should return HTTP agents for an http:// proxy url', () => {
      mockProxy({ enabled: true, url: 'http://127.0.0.1:8080' });
      const options = getAxiosProxyOptions(CDN_URL);
      expect(options.httpAgent.constructor.name).toBe('HttpProxyAgent');
      expect(options.httpsAgent.constructor.name).toBe('HttpsProxyAgent');
    });

    it('should reuse cached agents for the same proxy url', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:9999' });
      expect(getAxiosProxyOptions(CDN_URL).httpsAgent)
        .toBe(getAxiosProxyOptions(CDN_URL).httpsAgent);
    });
  });

  describe('getBrowserProxyArgs', () => {
    it('should return no args when the proxy is disabled', () => {
      mockProxy({ enabled: false, url: 'socks5://127.0.0.1:1080', useForBrowser: true });
      expect(getBrowserProxyArgs()).toEqual([]);
    });

    it('should return no args when useForBrowser is false', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080' });
      expect(getBrowserProxyArgs()).toEqual([]);
    });

    it('should return the chromium proxy flag when enabled for the browser', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', useForBrowser: true });
      expect(getBrowserProxyArgs()).toEqual(['--proxy-server=socks5://127.0.0.1:1080']);
    });
  });

  describe('describeProxy', () => {
    it('should return null when disabled', () => {
      mockProxy({ enabled: false, url: '' });
      expect(describeProxy()).toBeNull();
    });

    it('should mask credentials in the proxy url', () => {
      mockProxy({ enabled: true, url: 'http://user:secret@proxy.example:8080' });
      const description = describeProxy();
      expect(description).toContain('//***@proxy.example:8080');
      expect(description).not.toContain('secret');
    });

    it('should describe an all-hosts configuration', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: [], useForBrowser: true });
      expect(describeProxy()).toBe('socks5://127.0.0.1:1080 → all hosts + browser');
    });

    it('should describe a scoped configuration', () => {
      mockProxy({ enabled: true, url: 'socks5://127.0.0.1:1080', onlyHosts: ['n1.kemono.cr'] });
      expect(describeProxy()).toBe('socks5://127.0.0.1:1080 → 1 host(s)');
    });
  });
});
