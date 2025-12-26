const axios = require('axios');
const { delay } = require('../utils/delay');
const config = require('../utils/config');
const { sanitizeFilename } = require('../utils/urlUtils');
const browserClient = require('../utils/browserClient');

/**
 * Kemono API utilities
 */

/**
 * Performs an HTTP request with retry logic
 * Uses Puppeteer browser client for API endpoints to bypass Cloudflare
 */
async function makeRequestWithRetry(url, onLog) {
  const retryAttempts = config.getRetryAttempts();
  const retryDelay = config.getRetryDelay();
  const apiDelay = config.getAPIDelay();
  const baseUrl = config.getBaseUrl();

  // Add configurable delay before each request to be respectful to the server
  await delay(apiDelay);

  // Detect if this is an API endpoint
  const isApiEndpoint = url.includes('/api/') || url.includes('/api/v1/');

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      let response;

      if (isApiEndpoint) {
        // Use browser client for API endpoints to bypass Cloudflare
        response = await browserClient.fetchJSON(url, onLog);
      } else {
        // Use axios for regular HTML pages
        const userAgent = config.getUserAgent();
        response = await axios.get(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': `${baseUrl}/`,
            'Origin': baseUrl,
            'DNT': '1',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
          },
          timeout: config.getTimeout()
        });
      }

      return response;
    } catch (error) {
      const statusCode = error.response?.status || (error.message.includes('HTTP') ? parseInt(error.message.match(/\d+/)?.[0]) : null);
      const errorMessage = error.message;

      if (attempt === retryAttempts) {
        // Final attempt failed
        if (onLog) onLog(`❌ Failed after ${retryAttempts} attempts: ${url} - ${errorMessage}`);
        throw error;
      } else {
        // Retry for server errors (5xx) and rate limiting (429)
        if (statusCode >= 500 || statusCode === 429 || statusCode === 403) {
          if (onLog) onLog(`🔄 Retrying ${url} (attempt ${attempt + 1}/${retryAttempts}) - Status: ${statusCode}`);
          await delay(retryDelay);
        } else {
          // Don't retry for client errors like 404
          if (onLog) onLog(`❌ Request failed with status ${statusCode}: ${url} - ${errorMessage}`);
          throw error;
        }
      }
    }
  }
}

async function fetchPage(url, onLog) {
  try {
    if (onLog) onLog(`🌐 Fetching: ${url}`);

    // Use browser client to render the page with JavaScript
    // This is necessary because kemono.cr is a SPA
    const html = await browserClient.fetchRenderedPage(url, onLog);

    if (onLog) onLog(`✅ Page loaded successfully`);
    return html;
  } catch (error) {
    if (onLog) onLog(`❌ Failed to fetch page ${url}: ${error.message}`);
    return null;
  }
}

async function fetchPostsFromAPI(service, userId, onLog) {
  const allPosts = [];
  let profileName = null;
  const baseUrl = config.getBaseUrl();

  try {
    // First, try to get profile information
    const profileUrls = [
      `${baseUrl}/api/v1/${service}/user/${userId}/profile`,
      `${baseUrl}/api/${service}/user/${userId}/profile`
    ];

    for (const profileUrl of profileUrls) {
      try {
        if (onLog) onLog(`👤 Fetching profile info: ${profileUrl}`);
        const profileResponse = await makeRequestWithRetry(profileUrl, onLog);
        const profileData = profileResponse.data;

        if (profileData.name) {
          profileName = sanitizeFilename(profileData.name);
          if (onLog) onLog(`✅ Found profile name: ${profileName}`);
          break;
        }
      } catch (error) {
        // Continue to next profile URL
      }
    }

    // Try common Kemono API patterns with pagination support
    const baseApiUrls = [
      `${baseUrl}/api/v1/${service}/user/${userId}/posts`,
      `${baseUrl}/api/${service}/user/${userId}/posts`
    ];

    for (const baseApiUrl of baseApiUrls) {
      if (onLog) onLog(`🌐 Trying API: ${baseApiUrl}`);

      try {
        // First, try without pagination to see if we get data
        const response = await makeRequestWithRetry(baseApiUrl, onLog);
        if (onLog) onLog(`✅ API response received (${JSON.stringify(response.data).length} chars)`);

        // Handle different response formats
        let postsData = response.data;
        if (Array.isArray(postsData)) {
          postsData = postsData;
        } else if (postsData.posts && Array.isArray(postsData.posts)) {
          postsData = postsData.posts;
        } else if (postsData.data && Array.isArray(postsData.data)) {
          postsData = postsData.data;
        } else {
          if (onLog) onLog(`⚠️  Unexpected response format`);
          await delay(500);
          continue;
        }

        // If we got posts, this API endpoint works - now paginate through all pages
        if (postsData.length > 0) {
          if (onLog) onLog(`✅ Found working API endpoint with ${postsData.length} posts on first page`);

          // Add posts from first page
          for (const post of postsData) {
            if (post.id) {
              const postUrl = `${baseUrl}/${service}/user/${userId}/post/${post.id}`;
              allPosts.push({
                url: postUrl,
                id: post.id,
                username: profileName || `user_${userId}`,
                title: post.title || 'Untitled'
              });
            }
          }

          // Now paginate through remaining pages
          await fetchAllPages(baseApiUrl, service, userId, allPosts, onLog, profileName);

          if (allPosts.length > 0) {
            if (onLog) onLog(`✅ Successfully collected ${allPosts.length} total posts with pagination`);
            return allPosts;
          }
        }

      } catch (apiError) {
        if (onLog) onLog(`❌ API failed: ${apiError.response?.status || apiError.message}`);
      }

      // Add delay between API attempts
      await delay(500);
      if (onLog) onLog(`⏰ Waiting 500ms before next attempt...`);
    }

  } catch (error) {
    if (onLog) onLog(`❌ API approach failed: ${error.message}`);
  }

  return allPosts;
}

async function fetchAllPages(baseApiUrl, service, userId, allPosts, onLog, profileName) {
  let offset = 50; // Kemono typically uses 50 posts per page
  let hasMorePages = true;
  let pageNum = 2;

  while (hasMorePages) {
    try {
      // Try different pagination parameter formats
      const paginationUrls = [
        `${baseApiUrl}?o=${offset}`,           // offset parameter
        `${baseApiUrl}?offset=${offset}`,      // full offset parameter
        `${baseApiUrl}?page=${pageNum}`,       // page number
        `${baseApiUrl}?skip=${offset}`,        // skip parameter
        `${baseApiUrl}?start=${offset}`        // start parameter
      ];

      let pageFound = false;

      for (const paginatedUrl of paginationUrls) {
        if (onLog) onLog(`📄 Fetching page ${pageNum} (offset ${offset}): ${paginatedUrl}`);

        try {
          const response = await makeRequestWithRetry(paginatedUrl, onLog);

          let postsData = response.data;
          if (Array.isArray(postsData)) {
            postsData = postsData;
          } else if (postsData.posts && Array.isArray(postsData.posts)) {
            postsData = postsData.posts;
          } else if (postsData.data && Array.isArray(postsData.data)) {
            postsData = postsData.data;
          } else {
            continue; // Try next pagination format
          }

          if (postsData.length === 0) {
            if (onLog) onLog(`📄 Page ${pageNum} is empty - reached end`);
            hasMorePages = false;
            break;
          }

          // Add posts from this page
          let newPostsCount = 0;
          for (const post of postsData) {
            if (post.id) {
              // Check if we already have this post (avoid duplicates)
              const exists = allPosts.some(existingPost => existingPost.id === post.id);
              if (!exists) {
                const postUrl = `${config.getBaseUrl()}/${service}/user/${userId}/post/${post.id}`;
                allPosts.push({
                  url: postUrl,
                  id: post.id,
                  username: profileName || `user_${userId}`,
                  title: post.title || 'Untitled'
                });
                newPostsCount++;
              }
            }
          }

          if (onLog) onLog(`✅ Page ${pageNum}: Found ${newPostsCount} new posts (${postsData.length} total on page)`);
          pageFound = true;
          break; // This pagination format works, move to next page

        } catch (pageError) {
          // Try next pagination format
          continue;
        }
      }

      if (!pageFound) {
        if (onLog) onLog(`❌ No working pagination format found for page ${pageNum}`);
        hasMorePages = false;
        break;
      }

      offset += 50;
      pageNum++;

      // Add delay between pages to be respectful
      await delay(1000);

      // Safety limit to prevent infinite loops
      if (pageNum > 100) {
        if (onLog) onLog(`⚠️  Reached safety limit of 100 pages (${allPosts.length} posts collected)`);
        break;
      }

    } catch (error) {
      if (onLog) onLog(`❌ Error fetching page ${pageNum}: ${error.message}`);
      hasMorePages = false;
    }
  }
}

async function fetchPostFromAPI(post, onLog) {
  const baseUrl = config.getBaseUrl();

  try {
    // Extract service and userId from post URL
    const urlParts = post.url.split('/');
    const service = urlParts[3]; // e.g., 'patreon'
    const userId = urlParts[5];  // e.g., '42015243'
    const postId = post.id;

    const apiUrls = [
      `${baseUrl}/api/v1/${service}/user/${userId}/post/${postId}`,
      `${baseUrl}/api/${service}/user/${userId}/post/${postId}`,
      `${baseUrl}/api/v1/${service}/post/${postId}`,
      `${baseUrl}/api/${service}/post/${postId}`
    ];

    for (const apiUrl of apiUrls) {
      if (onLog) onLog(`🌐 Trying post API: ${apiUrl}`);

      try {
        const response = await makeRequestWithRetry(apiUrl, onLog);
        if (onLog) onLog(`✅ Post API response received`);
        return response.data;
      } catch (apiError) {
        if (onLog) onLog(`❌ Post API failed: ${apiError.response?.status || apiError.message}`);
      }

      // Add delay between API attempts
      await delay(500);
      if (onLog) onLog(`⏰ Waiting 500ms before next attempt...`);
    }
  } catch (error) {
    if (onLog) onLog(`❌ Post API approach failed: ${error.message}`);
  }

  return null;
}

module.exports = {
  fetchPage,
  fetchPostsFromAPI,
  fetchPostFromAPI
};
