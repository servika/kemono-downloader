# Enhanced HTML Parsing for kemono-downloader

## Overview

This document explains the enhanced HTML parsing capabilities that allow the downloader to work even when the API returns 403 errors or is blocked.

## Problem

Sometimes the kemono.cr API endpoints return **403 Forbidden** errors, making it impossible to download content via the API. However, the same content can be accessed through a web browser with proper cookies.

## Solution

The enhanced HTML parser extracts all necessary data directly from the rendered HTML pages, bypassing the need for API access entirely.

## Features

### 1. **Enhanced Profile Page Parser**
Located in: `src/extractors/htmlParser.js`

**Multiple extraction strategies:**
- Strategy 1: `.card-list__item` selectors (most common)
- Strategy 2: `article.post-card` and related selectors
- Strategy 3: Generic `a[href*="/post/"]` links
- Strategy 4: Regex-based extraction from raw HTML (fallback)

**Benefits:**
- Finds posts even if the HTML structure changes
- Extracts post URLs, IDs, and titles
- Works with various page layouts

### 2. **Enhanced Post Content Parser**
Located in: `src/extractors/htmlParser.js`

**Multiple extraction strategies:**
- Strategy 1: File attachments section (`.post__attachments`)
- Strategy 2: Images in post content (`.post__content img`)
- Strategy 3: Video elements (`.post__video`, `video` tags)
- Strategy 4: Download links (`a[download]`, `.fileThumb`)
- Strategy 5: Data attributes (`data-file`, `data-url`)
- Strategy 6: Regex-based URL extraction (finds hidden media URLs)

**Extracted media types:**
- Images (JPG, PNG, GIF, WebP, BMP)
- Videos (MP4, WebM, AVI, MOV, MKV, etc.)
- Archives (ZIP, RAR, 7Z)

### 3. **HTML-Only Mode**
When the API is completely blocked, you can enable HTML-only mode to skip all API calls.

## Configuration

### Enable HTML-Only Mode

Add to your `config.json`:

```json
{
  "htmlOnlyMode": true,
  "baseDirectory": "./downloads",
  "maxConcurrentImages": 3,
  "imageDelay": 500
}
```

When enabled, the downloader will:
- ✅ Use browser-based HTML fetching for all pages
- ✅ Extract all data from HTML (no API calls)
- ✅ Download media files directly from HTML-extracted URLs
- ⏭️ Skip all API endpoint requests

### Default Mode (API Fallback)

Without `htmlOnlyMode`, the downloader uses a smart fallback strategy:

1. **First**: Try browser HTML scraping
2. **If HTML fails**: Fall back to API endpoints
3. **If both fail**: Log error and continue

## How It Works

### Profile Page Extraction

```
User requests: https://kemono.cr/patreon/user/53451828
         ↓
Browser fetches page with cookies
         ↓
Enhanced HTML parser tries 4 strategies:
  1. Card list items
  2. Post cards
  3. Generic post links
  4. Regex extraction
         ↓
Returns list of post URLs
```

### Post Content Extraction

```
Post URL: https://kemono.cr/patreon/user/53451828/post/123
         ↓
Browser fetches post page
         ↓
Enhanced parser extracts from 6 sources:
  - Attachment sections
  - Image tags
  - Video elements
  - Download links
  - Data attributes
  - Regex patterns in HTML
         ↓
Returns all media URLs with metadata
```

## Usage Examples

### Example 1: Normal Usage (Automatic Fallback)

The downloader will automatically try HTML parsing first:

```bash
npm start
```

Output:
```
🔍 Analyzing profile for posts...
🌐 Trying browser HTML scraping...
  📄 Using enhanced HTML parser for post extraction...
  ✓ Found 150 posts using .card-list__item selector
👤 Found user: ArtistName
✅ Found 150 posts via HTML scraping
```

### Example 2: HTML-Only Mode (API Blocked)

When API returns 403 errors, enable HTML-only mode:

1. Edit `config.json`:
   ```json
   {
     "htmlOnlyMode": true
   }
   ```

2. Run normally:
   ```bash
   npm start
   ```

3. Output:
   ```
   🌐 HTML-only mode: ENABLED (API will be skipped)
   ...
   🌐 Trying browser HTML scraping...
   ✅ Found 150 posts via HTML scraping
   (API skipped - HTML-only mode)
   ```

### Example 3: Downloading Individual Posts

For each post, the enhanced parser will:

```
📄 Processing post: 123
🌐 Trying browser HTML fetch...
  📄 Using enhanced HTML parser for media extraction...
  ✓ Extracted 15 media files:
    - 10 from img-tags
    - 3 from attachments-section
    - 2 from regex-extraction
🖼️ Found 15 images to download from HTML
```

## Advantages Over API

1. **Works when API is blocked** - 403 errors don't affect browser access
2. **More robust** - Multiple fallback strategies
3. **Finds hidden media** - Regex extraction catches URLs in inline scripts
4. **No rate limiting** - Browser requests are less likely to be rate-limited
5. **Cookie support** - Uses your authentication cookies automatically

## Troubleshooting

### No Posts Found

If HTML parsing finds no posts:

1. **Check if the profile actually has posts** - Visit the URL manually in your browser
2. **Verify cookies are set** - Make sure your browser client has valid cookies
3. **Check console output** - Look for which extraction strategy was used
4. **Enable debug mode** - The parser logs which selectors it's trying

### Media Not Downloading

If posts are found but media isn't downloading:

1. **Check HTML structure** - The site may have changed its HTML layout
2. **Try API fallback** - Disable `htmlOnlyMode` to let API handle extraction
3. **Check console logs** - The parser shows which sources found media
4. **Verify URLs** - Check if the extracted URLs are valid

### Browser Client Issues

If browser fetching fails:

1. **Update cookies** - Your authentication may have expired
2. **Check network** - Ensure you can access kemono.cr
3. **Try without browser** - Some pages work without JavaScript
4. **Check logs** - Browser client logs detailed error messages

## Technical Details

### File Structure

```
src/extractors/
  ├── htmlParser.js          # Enhanced HTML parsing (NEW)
  └── imageExtractor.js      # Original API-based extraction

src/KemonoDownloader.js      # Main downloader with HTML-first logic
```

### Parser Functions

```javascript
// Profile parsing
extractPostsFromProfileHTML($, profileUrl)
  → Returns: [{ url, id, title, source }]

// Post content parsing
extractMediaFromPostHTML($, postUrl)
  → Returns: [{ url, filename, type, mediaType, source }]

// Username extraction
extractUsernameFromProfile($, profileUrl)
  → Returns: string

// Metadata extraction
extractPostMetadataFromHTML($, postUrl)
  → Returns: { title, content, published, user }
```

### Extraction Sources

The parser tracks where each media file was found:

- `attachments-section` - File attachment divs
- `img-tags` - HTML `<img>` elements
- `video-tags` - HTML `<video>` elements
- `download-links` - Download buttons/links
- `data-attributes` - Custom data-* attributes
- `regex-extraction` - Pattern matching in raw HTML

## Best Practices

1. **Use HTML-only mode when API is blocked** - Don't waste time on failed API calls
2. **Keep cookies updated** - Refresh your authentication periodically
3. **Monitor console output** - Watch which extraction strategies succeed
4. **Report issues** - If HTML structure changes, report it
5. **Test gradually** - Start with one profile to verify it works

## Future Enhancements

Planned improvements:

- [ ] JSON-LD structured data extraction
- [ ] Better SPA (Single Page Application) support
- [ ] Pagination handling for large profiles
- [ ] Post metadata extraction from HTML
- [ ] Customizable CSS selectors in config
- [ ] HTML structure detection and adaptation

## Support

If you encounter issues with HTML parsing:

1. Check this documentation
2. Review console logs for detailed extraction info
3. Try both normal and HTML-only modes
4. Report persistent issues with example URLs