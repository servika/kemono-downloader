# Configuration Guide

This guide explains all available configuration options for kemono-downloader.

## Quick Start

1. Copy `config.example.json` to `config.json`
2. Modify the settings to match your needs
3. Run `npm start`

## Configuration Sections

### Download Settings

Controls how downloads are performed and managed.

#### `maxConcurrentImages` (default: `3`)
- **Type**: Number (1-20)
- **Description**: Number of images to download simultaneously
- **Recommendations**:
  - `1-2`: Very slow connection or being respectful to server
  - `3-5`: Balanced performance (recommended)
  - `6-10`: Fast connection and want maximum speed
  - `10+`: High-speed connection, may trigger rate limiting

#### `maxConcurrentPosts` (default: `1`)
- **Type**: Number (1-5)
- **Description**: Number of posts to process simultaneously
- **Recommendations**:
  - `1`: Recommended for stability and avoiding browser resource issues
  - `2-3`: If you have a powerful machine and want faster processing
  - **Note**: Since we use Puppeteer, higher values consume more memory

#### `delayBetweenImages` (default: `400`)
- **Type**: Milliseconds
- **Description**: Delay between individual image downloads
- **Recommendations**:
  - `0-200`: Fast downloads, may trigger rate limiting
  - `200-500`: Balanced (recommended)
  - `500-1000`: Conservative, server-friendly
  - `1000+`: Very conservative

#### `delayBetweenPosts` (default: `1000`)
- **Type**: Milliseconds
- **Description**: Delay between processing different posts
- **Recommendations**:
  - `500-1000`: Balanced (recommended)
  - `1000-2000`: Conservative
  - `2000+`: Very conservative, useful if experiencing blocks

#### `delayBetweenAPIRequests` (default: `200`)
- **Type**: Milliseconds
- **Description**: Delay before each API request
- **Recommendations**:
  - `100-300`: Balanced (recommended)
  - `300-500`: Conservative
  - **Note**: With Puppeteer, API requests are less frequent

#### `delayBetweenPages` (default: `1000`)
- **Type**: Milliseconds
- **Description**: Delay between fetching paginated results
- **Recommendations**:
  - `500-1000`: Balanced (recommended)
  - `1000-2000`: Conservative
  - **Note**: Only applies if API pagination works

#### `retryAttempts` (default: `3`)
- **Type**: Number (1-10)
- **Description**: Number of times to retry failed requests
- **Recommendations**:
  - `2-3`: Balanced (recommended)
  - `3-5`: Flaky connection
  - `1`: Stable connection, want to fail fast

#### `retryDelay` (default: `2000`)
- **Type**: Milliseconds
- **Description**: Delay before retrying a failed request
- **Recommendations**:
  - `1000-2000`: Balanced (recommended)
  - `2000-5000`: Conservative, gives server time to recover
  - `5000+`: Very conservative

---

### API Settings

Controls browser and HTTP request behavior.

#### `baseUrl` (default: `"https://kemono.cr"`)
- **Type**: String (URL)
- **Description**: Base URL for the API endpoint
- **Supported values**:
  - `"https://kemono.cr"`: Default kemono.cr API (Patreon, Fanbox, etc.)
  - `"https://coomer.su"`: Alternative coomer.su API (OnlyFans, Fansly, etc.)
- **Usage**: Change this to switch between different API endpoints without modifying code
- **Example**:
  ```json
  {
    "api": {
      "baseUrl": "https://coomer.su"
    }
  }
  ```

#### `timeout` (default: `45000`)
- **Type**: Milliseconds
- **Description**: Maximum time to wait for a request to complete
- **Recommendations**:
  - `30000`: Fast connection
  - `45000`: Balanced (recommended)
  - `60000+`: Slow connection or large files
  - **Note**: With Puppeteer rendering, pages may take longer

#### `userAgent` (default: Chrome 120 User-Agent)
- **Type**: String
- **Description**: Browser user agent string for HTTP requests
- **Current Value**: `"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`
- **Recommendations**:
  - Use a recent Chrome/Firefox user agent string
  - Update periodically to match current browser versions
  - Find current user agents at: https://www.useragentstring.com/

#### `cookies` (default: `{ "session": "" }`)
- **Type**: Object
- **Description**: Authentication cookies for accessing protected content
- **Purpose**: Required to bypass 403 Forbidden errors on kemono.cr and coomer.su
- **How to get your session cookie**:
  1. Log into kemono.cr or coomer.su in your browser
  2. Open Developer Tools (F12)
  3. Go to Application/Storage tab → Cookies
  4. Find the cookie named `session`
  5. Copy its value
  6. Paste it into your config.json
- **Example**:
  ```json
  {
    "api": {
      "cookies": {
        "session": "eyJfcGVybWFuZW50Ijp0cnVlLCJhY2NvdW50X2lkIjoyNTU0NjcyfQ.aU7RgQ.IG4QXC_h5Z7VyNmqzCfNVFq2WcE"
      }
    }
  }
  ```
- **Security Note**: Keep your session cookie private - it gives access to your account

---

### Storage Settings

Controls where and how files are saved.

#### `baseDirectory` (default: `"download"`)
- **Type**: String (file path)
- **Description**: Directory where all downloads will be saved
- **Examples**:
  - `"download"`: Relative path in project directory
  - `"/Users/username/Downloads/kemono"`: Absolute path (macOS/Linux)
  - `"C:\\Users\\username\\Downloads\\kemono"`: Absolute path (Windows)
  - `"/Volumes/external-drive/kemono-content"`: External drive (macOS)
  - `"D:\\kemono-content"`: External drive (Windows)

#### `createSubfolders` (default: `true`)
- **Type**: Boolean
- **Description**: Create subfolders for each user and post
- **Structure when `true`**:
  ```
  baseDirectory/
  ├── username1/
  │   ├── post_id_1/
  │   │   ├── post-metadata.json
  │   │   ├── post.html
  │   │   ├── image1.jpg
  │   │   └── image2.png
  │   └── post_id_2/
  └── username2/
  ```
- **Structure when `false`**:
  ```
  baseDirectory/
  ├── image1.jpg
  ├── image2.png
  └── ...
  ```
- **Recommendations**: Keep `true` for organization

#### `sanitizeFilenames` (default: `true`)
- **Type**: Boolean
- **Description**: Remove invalid characters from filenames
- **Recommendations**: Keep `true` to avoid filesystem errors

#### `preserveOriginalNames` (default: `true`)
- **Type**: Boolean
- **Description**: Keep original image filenames when possible
- **Recommendations**: Keep `true` to maintain source filenames

---

### Logging Settings

Controls console output verbosity.

#### `verboseProgress` (default: `true`)
- **Type**: Boolean
- **Description**: Show detailed progress information during downloads
- **When `true`**: Shows download progress, percentages, file sizes
- **When `false`**: Shows only summary information
- **Recommendations**: Use `true` for monitoring, `false` for cleaner output

#### `showSkippedFiles` (default: `true`)
- **Type**: Boolean
- **Description**: Display messages for files that are skipped
- **When `true`**: Shows "Skipping: file.jpg (already exists)"
- **When `false`**: Skips silently
- **Recommendations**: Use `true` to verify resume functionality

#### `showDetailedErrors` (default: `true`)
- **Type**: Boolean
- **Description**: Show detailed error messages with stack traces
- **Recommendations**: Use `true` for debugging, `false` for production

---

## Example Configurations

### Fast Download (Maximum Speed)
```json
{
  "download": {
    "maxConcurrentImages": 10,
    "maxConcurrentPosts": 1,
    "delayBetweenImages": 100,
    "delayBetweenPosts": 500,
    "delayBetweenAPIRequests": 100,
    "delayBetweenPages": 500,
    "retryAttempts": 2,
    "retryDelay": 1000
  }
}
```
**Note**: May trigger rate limiting or get blocked

### Conservative (Server-Friendly)
```json
{
  "download": {
    "maxConcurrentImages": 2,
    "maxConcurrentPosts": 1,
    "delayBetweenImages": 1000,
    "delayBetweenPosts": 2000,
    "delayBetweenAPIRequests": 500,
    "delayBetweenPages": 2000,
    "retryAttempts": 5,
    "retryDelay": 3000
  }
}
```

### Balanced (Recommended)
```json
{
  "download": {
    "maxConcurrentImages": 3,
    "maxConcurrentPosts": 1,
    "delayBetweenImages": 400,
    "delayBetweenPosts": 1000,
    "delayBetweenAPIRequests": 200,
    "delayBetweenPages": 1000,
    "retryAttempts": 3,
    "retryDelay": 2000
  }
}
```

### External Drive Storage
```json
{
  "storage": {
    "baseDirectory": "/Volumes/4tb-1/kemono-content",
    "createSubfolders": true,
    "sanitizeFilenames": true,
    "preserveOriginalNames": true
  }
}
```

### Minimal Logging
```json
{
  "logging": {
    "verboseProgress": false,
    "showSkippedFiles": false,
    "showDetailedErrors": false
  }
}
```

---

## Troubleshooting

### Downloads are too slow
- Increase `maxConcurrentImages` to 5-10
- Decrease `delayBetweenImages` to 200ms or less
- Decrease `delayBetweenPosts` to 500ms

### Getting blocked or rate limited
- Decrease `maxConcurrentImages` to 1-2
- Increase `delayBetweenImages` to 1000ms or more
- Increase `delayBetweenPosts` to 2000ms or more
- Increase `delayBetweenAPIRequests` to 500ms or more

### Timeout errors
- Increase `api.timeout` to 60000ms (60 seconds)
- Check your internet connection
- Reduce concurrent downloads

### Out of memory errors (with Puppeteer)
- Decrease `maxConcurrentPosts` to 1
- Close other applications
- Restart the downloader periodically for long sessions

### Files not organizing correctly
- Ensure `createSubfolders` is `true`
- Check `baseDirectory` path is correct and writable
- Verify disk space is available

---

## Performance Considerations

### Browser Resource Usage
The downloader now uses Puppeteer (headless Chrome) which consumes:
- **Memory**: ~200-500MB per browser instance
- **CPU**: Moderate during page rendering
- **Recommendation**: Keep `maxConcurrentPosts` at 1 unless you have a powerful machine

### Network Bandwidth
- **Conservative**: ~50-100 KB/s (2-3 concurrent, 1000ms delay)
- **Balanced**: ~200-500 KB/s (3-5 concurrent, 400ms delay)
- **Aggressive**: ~1-2 MB/s (10+ concurrent, 100ms delay)

### Disk I/O
- SSD: Can handle any configuration
- HDD: Consider reducing concurrent downloads to avoid thrashing

---

## Best Practices

1. **Start conservative** - Use default settings first
2. **Monitor resource usage** - Watch CPU, memory, network
3. **Respect the server** - Add delays to avoid rate limiting
4. **Use external storage** - For large archives, use external drives
5. **Regular backups** - Keep backups of downloaded content
6. **Update user agent** - Keep browser fingerprint current
7. **Test configuration** - Try with a small profile first

---

## Configuration File Location

The application looks for `config.json` in the project root directory. If not found, it creates one with default values.

**Priority**:
1. `config.json` (if exists)
2. Creates default `config.json` from built-in defaults

You can maintain multiple config files:
```bash
cp config.json config.fast.json
cp config.json config.conservative.json
# Use specific config:
cp config.fast.json config.json
npm start
```
