#!/usr/bin/env node
/**
 * Network diagnostic: checks whether kemono.cr and its file CDN nodes are
 * reachable, both directly and through the configured proxy.
 *
 * Usage: npm run check-network
 */
const axios = require('axios');
const config = require('./../src/utils/config');
const { DEFAULT_PROXY_HOSTS, getAxiosProxyOptions, describeProxy } = require('../src/utils/proxyAgent');

const TEST_PATH = '/data/ae/19/ae19c3c12c7c5e625c9adbeb0b4687d73f482645f10d05d8b26e2ea9039c6667.jpg';
const TIMEOUT = 15000;

async function probe(url, useProxy) {
  const started = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT,
      maxRedirects: 0,
      responseType: 'stream',
      validateStatus: () => true,
      headers: {
        'User-Agent': config.getUserAgent(),
        // kemono's API rejects the default Accept header with 403
        Accept: 'text/css',
        Range: 'bytes=0-1023',
        Referer: 'https://kemono.cr/',
        ...(config.get('api.cookies.session')
          ? { Cookie: `session=${config.get('api.cookies.session')}` }
          : {})
      },
      ...(useProxy ? getAxiosProxyOptions(url) : {})
    });
    response.data.destroy();
    return { ok: response.status < 400, detail: `HTTP ${response.status}`, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, detail: error.code || error.message, ms: Date.now() - started };
  }
}

async function main() {
  await config.load();

  const proxyInfo = describeProxy();
  console.log(`\n🔎 Network check — proxy: ${proxyInfo || 'disabled'}\n`);

  const targets = [
    'https://kemono.cr/api/v1/patreon/user/29485424/post/134604746',
    ...DEFAULT_PROXY_HOSTS.filter(h => h.endsWith('kemono.cr')).map(h => `https://${h}${TEST_PATH}`)
  ];

  let cdnDirect = 0;
  let cdnProxied = 0;

  for (const url of targets) {
    const host = new URL(url).hostname;
    const isCdn = DEFAULT_PROXY_HOSTS.includes(host);

    const direct = await probe(url, false);
    let line = `${direct.ok ? '✅' : '❌'} ${host.padEnd(16)} direct: ${direct.detail} (${direct.ms}ms)`;
    if (direct.ok && isCdn) cdnDirect++;

    if (!direct.ok && proxyInfo) {
      const proxied = await probe(url, true);
      line += ` | proxy: ${proxied.ok ? '✅' : '❌'} ${proxied.detail} (${proxied.ms}ms)`;
      if (proxied.ok && isCdn) cdnProxied++;
    }
    console.log(line);
  }

  console.log('');
  if (cdnDirect > 0) {
    console.log('✅ File CDN reachable directly — no proxy needed for downloads.');
  } else if (cdnProxied > 0) {
    console.log('✅ File CDN reachable only through the proxy — keep network.proxy enabled.');
  } else {
    console.log('❌ File CDN unreachable. Only thumbnails can be downloaded until you');
    console.log('   route n1-n4.kemono.cr through a proxy (see network.proxy in config.json).');
  }
}

main().catch(error => {
  console.error('Check failed:', error.message);
  process.exit(1);
});
