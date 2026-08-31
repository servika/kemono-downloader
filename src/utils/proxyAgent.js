const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('./config');

/**
 * @fileoverview Optional proxy support for hosts that are unreachable directly.
 * kemono.cr serves files from n1-n4.kemono.cr (91.149.227.0/24); some ISP
 * subnets are blocked there while the main site stays reachable, so only the
 * file CDN needs to be tunneled.
 */

/** Hosts routed through the proxy when `network.proxy.onlyHosts` is not set */
const DEFAULT_PROXY_HOSTS = [
  'n1.kemono.cr', 'n2.kemono.cr', 'n3.kemono.cr', 'n4.kemono.cr',
  'n1.coomer.st', 'n2.coomer.st', 'n3.coomer.st', 'n4.coomer.st'
];

/** @type {Map<string, {http: object, https: object}>} */
const agentCache = new Map();

/**
 * Reads the proxy section of config.json
 * @returns {{enabled: boolean, url: string, onlyHosts: string[], useForBrowser: boolean}}
 */
function getProxySettings() {
  const proxy = config.get('network.proxy') || {};
  return {
    enabled: Boolean(proxy.enabled && proxy.url),
    url: proxy.url || '',
    onlyHosts: Array.isArray(proxy.onlyHosts) && proxy.onlyHosts.length > 0
      ? proxy.onlyHosts
      : DEFAULT_PROXY_HOSTS,
    useForBrowser: Boolean(proxy.useForBrowser)
  };
}

/**
 * Checks whether a URL must be tunneled
 * @param {string} url - Absolute URL
 * @returns {boolean}
 */
function shouldUseProxy(url) {
  const settings = getProxySettings();
  if (!settings.enabled) return false;

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  // An empty list in config means "everything through the proxy"
  const proxy = config.get('network.proxy') || {};
  if (Array.isArray(proxy.onlyHosts) && proxy.onlyHosts.length === 0) return true;

  return settings.onlyHosts.some(pattern => {
    const host = String(pattern).toLowerCase();
    return host.startsWith('*.')
      ? hostname === host.slice(2) || hostname.endsWith(host.slice(1))
      : hostname === host;
  });
}

/**
 * Builds (and caches) http/https agents for the configured proxy URL
 * @param {string} proxyUrl - e.g. socks5h://127.0.0.1:40000 or http://user:pass@host:8080
 * @returns {{http: object, https: object}}
 */
function createAgents(proxyUrl) {
  if (agentCache.has(proxyUrl)) return agentCache.get(proxyUrl);

  const isSocks = /^socks/i.test(proxyUrl);
  const agents = isSocks
    ? { http: new SocksProxyAgent(proxyUrl), https: new SocksProxyAgent(proxyUrl) }
    : { http: new HttpProxyAgent(proxyUrl), https: new HttpsProxyAgent(proxyUrl) };

  agentCache.set(proxyUrl, agents);
  return agents;
}

/**
 * Axios options that route a request through the proxy when the host needs it
 * @param {string} url - Absolute request URL
 * @returns {object} Options to spread into an axios config (empty when direct)
 */
function getAxiosProxyOptions(url) {
  if (!shouldUseProxy(url)) return {};

  const { url: proxyUrl } = getProxySettings();
  const agents = createAgents(proxyUrl);

  return {
    httpAgent: agents.http,
    httpsAgent: agents.https,
    proxy: false // disable axios' own env-based proxy handling
  };
}

/**
 * Puppeteer launch argument for the proxy, when browser traffic should use it
 * @returns {string[]} Extra args (empty when the browser goes direct)
 */
function getBrowserProxyArgs() {
  const { enabled, url, useForBrowser } = getProxySettings();
  if (!enabled || !useForBrowser) return [];
  return [`--proxy-server=${url}`];
}

/**
 * Human-readable proxy status for startup logging
 * @returns {string|null} Description, or null when no proxy is active
 */
function describeProxy() {
  const { enabled, url, onlyHosts, useForBrowser } = getProxySettings();
  if (!enabled) return null;

  const proxy = config.get('network.proxy') || {};
  const scope = Array.isArray(proxy.onlyHosts) && proxy.onlyHosts.length === 0
    ? 'all hosts'
    : `${onlyHosts.length} host(s)`;
  const safeUrl = url.replace(/\/\/[^@]*@/, '//***@');

  return `${safeUrl} → ${scope}${useForBrowser ? ' + browser' : ''}`;
}

module.exports = {
  DEFAULT_PROXY_HOSTS,
  getProxySettings,
  shouldUseProxy,
  getAxiosProxyOptions,
  getBrowserProxyArgs,
  describeProxy
};
