const { isImageUrl, isVideoUrl, isArchiveUrl, isDownloadableUrl } = require('../utils/urlUtils');

/**
 * Alternative HTML-based parser for kemono.cr
 * This parser extracts all data from rendered HTML without relying on API endpoints
 * Useful when API returns 403 errors but browser access works
 */

/**
 * Extract posts from profile page HTML using multiple strategies
 */
function extractPostsFromProfileHTML($, profileUrl) {
  const posts = [];
  const baseUrl = 'https://kemono.cr';

  console.log('  📄 Using enhanced HTML parser for post extraction...');

  // Strategy 1: Look for post-card articles (actual kemono.cr structure)
  const postCards = $('article.post-card');
  if (postCards.length > 0) {
    console.log(`  ✓ Found ${postCards.length} posts using article.post-card selector`);
    postCards.each((index, element) => {
      const $card = $(element);
      const postId = $card.attr('data-id');
      const postLink = $card.find('a.fancy-link').first();
      const postUrl = postLink.attr('href');

      if (postUrl) {
        const fullUrl = postUrl.startsWith('http') ? postUrl : `${baseUrl}${postUrl}`;
        const title = $card.find('header.post-card__header').text().trim() || 'Untitled';
        const timestamp = $card.find('time.timestamp').attr('datetime') || '';

        posts.push({
          url: fullUrl,
          id: postId || extractPostIdFromUrl(fullUrl),
          title: title,
          published: timestamp,
          source: 'post-card'
        });
      }
    });
  }

  // Strategy 2: Look for card-list items (fallback)
  if (posts.length === 0) {
    const cardListItems = $('.card-list__item');
    if (cardListItems.length > 0) {
      console.log(`  ✓ Found ${cardListItems.length} posts using .card-list__item selector`);
      cardListItems.each((index, element) => {
        const $card = $(element);
        const postLink = $card.find('a[href*="/post/"]').first();
        const postUrl = postLink.attr('href');

        if (postUrl) {
          const fullUrl = postUrl.startsWith('http') ? postUrl : `${baseUrl}${postUrl}`;
          const postId = extractPostIdFromUrl(fullUrl);
          const title = postLink.attr('title') || $card.find('.card__title').text().trim() || 'Untitled';

          posts.push({
            url: fullUrl,
            id: postId,
            title: title,
            source: 'card-list'
          });
        }
      });
    }
  }

  // Strategy 3: Find all links containing /post/
  if (posts.length === 0) {
    const postLinks = $('a[href*="/post/"]');
    console.log(`  ✓ Found ${postLinks.length} post links using generic selector`);

    const seenIds = new Set();
    postLinks.each((index, element) => {
      const postUrl = $(element).attr('href');
      if (postUrl) {
        const fullUrl = postUrl.startsWith('http') ? postUrl : `${baseUrl}${postUrl}`;
        const postId = extractPostIdFromUrl(fullUrl);

        // Avoid duplicates
        if (!seenIds.has(postId)) {
          seenIds.add(postId);
          const title = $(element).attr('title') || $(element).text().trim() || 'Untitled';

          posts.push({
            url: fullUrl,
            id: postId,
            title: title,
            source: 'generic-link'
          });
        }
      }
    });
  }

  // Strategy 4: Regex-based extraction from raw HTML as last resort
  if (posts.length === 0) {
    console.log('  ⚠️  No posts found with CSS selectors, trying regex extraction...');
    const html = $.html();
    const postUrlRegex = /href=["']([^"']*\/post\/[^"']+)["']/gi;
    const matches = [...html.matchAll(postUrlRegex)];

    const seenIds = new Set();
    for (const match of matches) {
      const postUrl = match[1];
      const fullUrl = postUrl.startsWith('http') ? postUrl : `${baseUrl}${postUrl}`;
      const postId = extractPostIdFromUrl(fullUrl);

      if (!seenIds.has(postId)) {
        seenIds.add(postId);
        posts.push({
          url: fullUrl,
          id: postId,
          title: 'Untitled',
          source: 'regex'
        });
      }
    }
    console.log(`  ✓ Found ${posts.length} posts using regex extraction`);
  }

  return posts;
}

/**
 * Extract all media from post page HTML using multiple strategies
 */
function extractMediaFromPostHTML($, postUrl) {
  const mediaFiles = [];
  const baseUrl = 'https://kemono.cr';

  console.log('  📄 Using enhanced HTML parser for media extraction...');

  // Strategy 1: Look for fileThumb links (actual kemono.cr structure)
  $('.post__files .fileThumb, .post__thumbnail .fileThumb, a.fileThumb').each((index, element) => {
    const $link = $(element);
    const downloadLink = $link.attr('href');
    const filename = $link.attr('download');

    if (downloadLink && isDownloadableUrl(downloadLink)) {
      const fullUrl = downloadLink.startsWith('http') ? downloadLink : `https:${downloadLink}`;

      // Avoid duplicates
      if (!mediaFiles.some(m => m.url === fullUrl)) {
        mediaFiles.push({
          url: fullUrl,
          filename: filename || null,
          type: 'file-thumb',
          mediaType: determineMediaType(fullUrl),
          source: 'fileThumb-links'
        });
      }
    }
  });

  // Strategy 2: Look for post__attachments and post__files sections
  $('.post__attachments .post__attachment, .post__files .post__file').each((index, element) => {
    const $attachment = $(element);

    // Try different link patterns
    const link = $attachment.find('a').first();
    const downloadLink = link.attr('href') || link.attr('data-href');

    if (downloadLink && isDownloadableUrl(downloadLink)) {
      const fullUrl = downloadLink.startsWith('http') ? downloadLink : (downloadLink.startsWith('//') ? `https:${downloadLink}` : `${baseUrl}${downloadLink}`);
      const filename = link.text().trim() || link.attr('download') || $attachment.find('.post__attachment-name').text().trim();

      if (!mediaFiles.some(m => m.url === fullUrl)) {
        mediaFiles.push({
          url: fullUrl,
          filename: filename || null,
          type: 'attachment',
          mediaType: determineMediaType(fullUrl),
          source: 'attachments-section'
        });
      }
    }
  });

  // Strategy 3: Look for images with data-src attributes (lazy loaded)
  $('img.post__image, .post__thumbnail img, .post__content img, article img').each((index, element) => {
    const $img = $(element);
    const imgSrc = $img.attr('data-src') || $img.attr('src') || $img.attr('data-original');

    if (imgSrc && !imgSrc.includes('avatar') && !imgSrc.includes('icon')) {
      let fullUrl = imgSrc;
      let thumbnailUrl = null;

      // Check if this is a thumbnail URL
      const isThumbnail = fullUrl.includes('/thumbnail/') || fullUrl.includes('_thumb.') || fullUrl.includes('.thumb.');

      if (isThumbnail) {
        // Keep original thumbnail as fallback
        thumbnailUrl = fullUrl.startsWith('http') ? fullUrl : (fullUrl.startsWith('//') ? `https:${fullUrl}` : `${baseUrl}${fullUrl}`);

        // Convert to full resolution URL
        if (fullUrl.includes('/thumbnail/')) {
          fullUrl = fullUrl.replace('/thumbnail/', '/data/');
        }
        if (fullUrl.includes('_thumb.')) {
          fullUrl = fullUrl.replace('_thumb.', '.');
        }
        if (fullUrl.includes('.thumb.')) {
          fullUrl = fullUrl.replace('.thumb.', '.');
        }
      }

      fullUrl = fullUrl.startsWith('http') ? fullUrl : (fullUrl.startsWith('//') ? `https:${fullUrl}` : `${baseUrl}${fullUrl}`);

      // Avoid duplicates - check both full and thumbnail URLs
      const isDuplicate = mediaFiles.some(m => m.url === fullUrl || m.thumbnailUrl === fullUrl);

      if (!isDuplicate) {
        mediaFiles.push({
          url: fullUrl,
          thumbnailUrl: thumbnailUrl, // Keep thumbnail as fallback
          filename: $img.attr('alt') || null,
          type: 'image',
          mediaType: 'image',
          source: 'img-tags'
        });
      }
    }
  });

  // Strategy 4: Look for videos
  $('video.post__video, .post__content video, article video').each((index, element) => {
    const $video = $(element);
    const videoSrc = $video.attr('src') || $video.attr('data-src') || $video.find('source').attr('src');

    if (videoSrc) {
      const fullUrl = videoSrc.startsWith('http') ? videoSrc : (videoSrc.startsWith('//') ? `https:${videoSrc}` : `${baseUrl}${videoSrc}`);

      if (!mediaFiles.some(m => m.url === fullUrl)) {
        mediaFiles.push({
          url: fullUrl,
          filename: null,
          type: 'video',
          mediaType: 'video',
          source: 'video-tags'
        });
      }
    }
  });

  // Strategy 5: Look for download buttons and links
  $('a.post__attachment-link, a.image-link, a[download], a[href*="/data/"], a[href*="/files/"], a[href*="kemono.cr/data"]').each((index, element) => {
    const $link = $(element);
    const href = $link.attr('href');

    if (href && isDownloadableUrl(href)) {
      const fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `${baseUrl}${href}`);

      if (!mediaFiles.some(m => m.url === fullUrl)) {
        mediaFiles.push({
          url: fullUrl,
          filename: $link.attr('download') || $link.text().trim() || null,
          type: 'download-link',
          mediaType: determineMediaType(fullUrl),
          source: 'download-links'
        });
      }
    }
  });

  // Strategy 6: Extract from data attributes (some sites store URLs in data-* attributes)
  $('[data-file], [data-url]').each((index, element) => {
    const $el = $(element);
    const dataUrl = $el.attr('data-file') || $el.attr('data-url');

    if (dataUrl && isDownloadableUrl(dataUrl) && !dataUrl.includes('/thumbnail/')) {
      const fullUrl = dataUrl.startsWith('http') ? dataUrl : (dataUrl.startsWith('//') ? `https:${dataUrl}` : `${baseUrl}${dataUrl}`);

      if (!mediaFiles.some(m => m.url === fullUrl)) {
        mediaFiles.push({
          url: fullUrl,
          filename: null,
          type: 'data-attribute',
          mediaType: determineMediaType(fullUrl),
          source: 'data-attributes'
        });
      }
    }
  });

  // Strategy 7: Regex-based extraction from HTML content
  const html = $.html();
  const urlPatterns = [
    // Kemono CDN patterns (n1.kemono.cr, n2.kemono.cr, etc.)
    /https?:\/\/n\d+\.kemono\.cr\/data\/[^\s"'<>)]+/gi,
    /https?:\/\/[^\/]*kemono[^\/]*\/data\/[^\s"'<>)]+/gi,
    /\/\/img\.kemono\.cr\/data\/[^\s"'<>)]+/gi,
    // Generic media URL patterns
    /https?:\/\/[^\s"'<>)]+\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|avi|mov|wmv|flv|mkv|m4v|zip|rar|7z)/gi,
  ];

  for (const pattern of urlPatterns) {
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      let url = match[0];

      // Convert protocol-relative URLs
      if (url.startsWith('//')) {
        url = `https:${url}`;
      }

      // Skip thumbnail URLs
      if (url.includes('/thumbnail/')) {
        continue;
      }

      if (isDownloadableUrl(url) && !mediaFiles.some(m => m.url === url)) {
        mediaFiles.push({
          url: url,
          filename: null,
          type: 'regex-extracted',
          mediaType: determineMediaType(url),
          source: 'regex-extraction'
        });
      }
    }
  }

  // Log extraction summary
  const summary = mediaFiles.reduce((acc, file) => {
    acc[file.source] = (acc[file.source] || 0) + 1;
    return acc;
  }, {});

  console.log(`  ✓ Extracted ${mediaFiles.length} media files:`);
  for (const [source, count] of Object.entries(summary)) {
    console.log(`    - ${count} from ${source}`);
  }

  return mediaFiles;
}

/**
 * Extract post metadata from HTML
 */
function extractPostMetadataFromHTML($, postUrl) {
  const metadata = {
    url: postUrl,
    id: extractPostIdFromUrl(postUrl),
    title: null,
    content: null,
    published: null,
    user: null
  };

  // Extract title
  metadata.title =
    $('.post__title').first().text().trim() ||
    $('h1.title').first().text().trim() ||
    $('article h1').first().text().trim() ||
    $('title').text().trim().split('|')[0].trim() ||
    'Untitled';

  // Extract content/description
  metadata.content =
    $('.post__content').html() ||
    $('.post__body').html() ||
    $('article .content').html() ||
    '';

  // Extract published date
  const dateText =
    $('time.post__published, .post__published, time[datetime]').attr('datetime') ||
    $('.post__date').text().trim() ||
    $('time').first().text().trim();

  if (dateText) {
    metadata.published = dateText;
  }

  // Extract user info
  metadata.user =
    $('.post__user-name').text().trim() ||
    $('.user__name').text().trim() ||
    $('[class*="author"]').first().text().trim() ||
    null;

  return metadata;
}

/**
 * Helper: Extract post ID from URL
 */
function extractPostIdFromUrl(url) {
  const match = url.match(/\/post\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Helper: Determine media type from URL
 */
function determineMediaType(url) {
  if (isVideoUrl(url)) return 'video';
  if (isArchiveUrl(url)) return 'archive';
  if (isImageUrl(url)) return 'image';
  return 'unknown';
}

/**
 * Extract username from profile page
 */
function extractUsernameFromProfile($, profileUrl) {
  // Try multiple selectors based on actual kemono.cr structure
  const username =
    $('.user-header__profile span[itemprop="name"]').text().trim() ||
    $('.user-header__name a').text().trim() ||
    $('.user-header__name').text().trim() ||
    $('.profile__name').text().trim() ||
    $('h1.user__name').text().trim() ||
    $('.user__name').first().text().trim() ||
    $('[class*="user"] [class*="name"]').first().text().trim();

  if (username) {
    return username;
  }

  // Try to extract from meta tags
  const metaArtist = $('meta[name="artist_name"]').attr('content');
  if (metaArtist) {
    return metaArtist;
  }

  // Try to extract from page title
  const titleText = $('title').text();
  if (titleText) {
    // Match pattern like: Posts of "invaklina" from "Patreon"
    const titleMatch = titleText.match(/Posts of "([^"]+)"/);
    if (titleMatch) {
      return titleMatch[1];
    }

    // Fallback to first part before |
    const simpleTitleMatch = titleText.match(/^([^|]+)/);
    if (simpleTitleMatch) {
      return simpleTitleMatch[1].trim();
    }
  }

  // Fallback: try to extract from URL
  const urlMatch = profileUrl.match(/\/user\/([^/?#]+)/);
  if (urlMatch) {
    return `user_${urlMatch[1]}`;
  }

  return 'unknown_user';
}

module.exports = {
  extractPostsFromProfileHTML,
  extractMediaFromPostHTML,
  extractPostMetadataFromHTML,
  extractUsernameFromProfile,
  extractPostIdFromUrl
};