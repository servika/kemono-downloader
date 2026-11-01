const axios = require('axios');
const config = require('./config');
const { delay } = require('./delay');
const { getAxiosProxyOptions } = require('./proxyAgent');
const { version } = require('../../package.json');

/**
 * @fileoverview Finds a failed file on a mirror site (pawchive by default).
 *
 * Mirrors expose the same /{service}/user/{id}/post/{postId} links and the same
 * content-addressed file paths as kemono, so a file is matched by its SHA-256
 * name. The file host cannot be derived from the failed URL (it varies per file:
 * n2.pawchive.pw, file.pawchive.pw), so it is read from the mirror's post page.
 *
 * Mirror rules, stated by pawchive in its 403 response: at most 1 request per
 * second and 5 active downloads, an identifiable user agent, no pretending to
 * be a browser. Cookies from config belong to the primary site and are never
 * sent to a mirror.
 */

const MIRROR_USER_AGENT = `kemono-downloader/${version} (+https://github.com/servika/kemono-downloader)`;
const MAX_ACTIVE_REQUESTS = 5;
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_CACHED_POSTS = 100;

const FILE_HASH_PATTERN = /\/([0-9a-f]{64})\.[^/.]+$/i;
const POST_PATH_PATTERN = /^\/[a-z0-9_-]+\/user\/[^/]+\/post\/[^/]+\/?$/i;
// Anchored on host + /data/ so that /thumbnail/data/ previews never match
const MIRROR_FILE_PATTERN = /https:\/\/[a-z0-9.-]+\/data\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})\.[a-z0-9]+(?:\?[^"'\s<>]*)?/gi;

let activeRequests = 0;
let nextRequestAt = 0;
let blocked = false;
/** @type {Map<string, Promise<Map<string, string>>>} */
const postFilesCache = new Map();

function getMirrorHostnames() {
  const hostnames = [];
  for (const mirror of config.getMirrors() || []) {
    try {
      hostnames.push(new URL(mirror).hostname.toLowerCase());
    } catch {
      // Ignore malformed entries in config
    }
  }
  return hostnames;
}

/**
 * @param {string} url
 * @returns {boolean} True when the URL is on a configured mirror or its subdomain
 */
function isMirrorUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return getMirrorHostnames().some(host => hostname === host || hostname.endsWith(`.${host}`));
}

/**
 * Runs a mirror request within the site's limits, across all concurrent callers.
 * @template T
 * @param {function(): Promise<T>} request
 * @returns {Promise<T>}
 */
async function withMirrorSlot(request) {
  while (activeRequests >= MAX_ACTIVE_REQUESTS) {
    await delay(50);
  }
  activeRequests++;

  try {
    const now = Date.now();
    const startAt = Math.max(now, nextRequestAt);
    nextRequestAt = startAt + MIN_REQUEST_INTERVAL_MS;
    if (startAt > now) {
      await delay(startAt - now);
    }
    return await request();
  } finally {
    activeRequests--;
  }
}

/**
 * Stops using mirrors for the rest of the run once one refuses us: continuing
 * after a 403/429 is what the mirror says will get the client blocked.
 * @param {Error} error
 * @param {function(string): void} [onProgress]
 */
function reportMirrorFailure(error, onProgress) {
  const status = error.response?.status;
  if (status === 403 || status === 429) {
    blocked = true;
    if (onProgress) onProgress(`⛔ Mirror refused the request (${status}) - not using mirrors for the rest of this run`);
  } else if (onProgress) {
    onProgress(`⚠️  Mirror failed: ${error.message}`);
  }
}

async function fetchPostFiles(postUrl, onProgress) {
  const files = new Map();
  try {
    const response = await withMirrorSlot(() => axios.get(postUrl, {
      responseType: 'text',
      headers: { 'User-Agent': MIRROR_USER_AGENT },
      timeout: config.getTimeout(),
      ...getAxiosProxyOptions(postUrl)
    }));

    for (const match of String(response.data).matchAll(MIRROR_FILE_PATTERN)) {
      const fileUrl = match[0].replace(/&amp;/g, '&');
      const hash = match[1].toLowerCase();
      // Page content is untrusted: only accept links hosted by a configured mirror
      if (isMirrorUrl(fileUrl) && !files.has(hash)) {
        files.set(hash, fileUrl);
      }
    }
  } catch (error) {
    // A 404 only means this mirror has no such post
    if (error.response?.status !== 404) {
      reportMirrorFailure(error, onProgress);
    }
  }
  return files;
}

function getPostFiles(postUrl, onProgress) {
  if (!postFilesCache.has(postUrl)) {
    if (postFilesCache.size >= MAX_CACHED_POSTS) {
      postFilesCache.clear();
    }
    postFilesCache.set(postUrl, fetchPostFiles(postUrl, onProgress));
  }
  return postFilesCache.get(postUrl);
}

/**
 * Finds the same file on a mirror: same post link, same content hash.
 *
 * @param {string} fileUrl - URL that failed to download
 * @param {string} postUrl - Post the file belongs to, on the primary site
 * @param {function(string): void} [onProgress]
 * @returns {Promise<string|null>} Full-resolution mirror URL, or null if unavailable
 */
async function resolveMirrorUrl(fileUrl, postUrl, onProgress) {
  if (blocked || isMirrorUrl(fileUrl)) return null;

  let filePath;
  let postPath;
  try {
    filePath = new URL(fileUrl).pathname;
    postPath = new URL(postUrl).pathname;
  } catch {
    return null;
  }

  const hashMatch = filePath.match(FILE_HASH_PATTERN);
  if (!hashMatch || !POST_PATH_PATTERN.test(postPath)) return null;
  const hash = hashMatch[1].toLowerCase();

  for (const mirror of config.getMirrors() || []) {
    if (blocked) return null;

    let mirrorPostUrl;
    try {
      mirrorPostUrl = new URL(postPath, mirror).href;
    } catch {
      continue;
    }

    const files = await getPostFiles(mirrorPostUrl, onProgress);
    if (files.has(hash)) {
      return files.get(hash);
    }
  }
  return null;
}

function resetMirrorState() {
  activeRequests = 0;
  nextRequestAt = 0;
  blocked = false;
  postFilesCache.clear();
}

module.exports = {
  MIRROR_USER_AGENT,
  isMirrorUrl,
  withMirrorSlot,
  reportMirrorFailure,
  resolveMirrorUrl,
  resetMirrorState
};
