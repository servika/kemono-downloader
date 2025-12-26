# Kemono posts downloader

A Node.js application for downloading posts and images from kemono.cr profiles with concurrent downloads, retry logic, and comprehensive error handling.

## Features

- **Bulk Profile Processing**: Download from multiple profiles using a simple text file
- **Concurrent Downloads**: Configurable concurrent image downloads for faster processing
- **Smart Resume**: Automatically detects and skips already downloaded content
- **Retry Logic**: Automatic retry with exponential backoff for failed downloads
- **Multiple Data Sources**: Uses API endpoints with HTML fallback for maximum compatibility
- **Robust Error Handling**: Comprehensive error handling with detailed logging
- **Configurable Settings**: Extensive configuration options via `config.json`
- **Progress Tracking**: Real-time progress bars and detailed statistics

## Installation

1. Clone the repository:
```bash
git clone https://github.com/servika/kemono-downloader.git
cd kemono-downloader
```

2. Install dependencies:
```bash
npm install
```

3. Copy example configuration files:
```bash
cp config.example.json config.json
cp profiles.example.txt profiles.txt
```

4. Edit `profiles.txt` with the profiles you want to download

## Quick Start

1. Add kemono.cr profile URLs to `profiles.txt`, one per line:
```
https://kemono.cr/patreon/user/1
https://kemono.cr/patreon/user/2
https://kemono.cr/fanbox/user/3
```

2. Run the downloader:
```bash
npm start
```

Or specify a custom profiles file:
```bash
node index.js my-profiles.txt
```

## Configuration

The application creates a `config.json` file on first run with the following default settings:

```json
{
  "download": {
    "maxConcurrentImages": 3,
    "maxConcurrentPosts": 1,
    "delayBetweenImages": 200,
    "delayBetweenPosts": 500,
    "delayBetweenAPIRequests": 500,
    "delayBetweenPages": 1000,
    "retryAttempts": 3,
    "retryDelay": 1000
  },
  "api": {
    "timeout": 45000,
    "userAgent": "Mozilla/5.0 (compatible; kemono-downloader)"
  },
  "storage": {
    "baseDirectory": "download",
    "createSubfolders": true,
    "sanitizeFilenames": true,
    "preserveOriginalNames": true
  },
  "logging": {
    "verboseProgress": true,
    "showSkippedFiles": true,
    "showDetailedErrors": true
  }
}
```

### Configuration Options

#### Download Settings
- `maxConcurrentImages`: Number of images to download simultaneously (1-20)
- `maxConcurrentPosts`: Number of posts to process simultaneously (recommended: 1)
- `delayBetweenImages`: Milliseconds to wait between image downloads
- `delayBetweenPosts`: Milliseconds to wait between post processing
- `delayBetweenAPIRequests`: Milliseconds to wait between API calls
- `delayBetweenPages`: Milliseconds to wait between page requests
- `retryAttempts`: Number of retry attempts for failed downloads
- `retryDelay`: Milliseconds to wait before retrying failed downloads

#### API Settings
- `timeout`: Request timeout in milliseconds
- `userAgent`: User agent string for HTTP requests

#### Storage Settings
- `baseDirectory`: Base directory for downloads
- `createSubfolders`: Create subfolders for each user
- `sanitizeFilenames`: Remove invalid characters from filenames
- `preserveOriginalNames`: Keep original image filenames when possible

#### Logging Settings
- `verboseProgress`: Show detailed progress information
- `showSkippedFiles`: Display messages for skipped files
- `showDetailedErrors`: Show detailed error messages

## Directory Structure

Downloaded content is organized as follows:
```
download/
├── username1/
│   ├── post_id_1/
│   │   ├── post-metadata.json
│   │   ├── post.html (if API fails)
│   │   ├── image1.jpg
│   │   ├── image2.png
│   │   └── ...
│   └── post_id_2/
│       └── ...
└── username2/
    └── ...
```

## Features in Detail

### Smart Resume Functionality
- Detects previously downloaded posts and skips them automatically
- Verifies image file integrity and re-downloads corrupted files
- Resumes partial downloads from where they left off

### Concurrent Downloads
- Downloads multiple images simultaneously for faster processing
- Configurable concurrency limits to avoid overwhelming servers
- Automatic rate limiting with configurable delays

### Error Handling
- Automatic retry with exponential backoff for network failures
- Graceful handling of timeouts and connection errors
- Detailed error logging for troubleshooting

### Data Sources
1. **API Endpoints**: Primary method for fetching post data and image URLs
2. **HTML Scraping**: Fallback method when API endpoints are unavailable
3. **Multiple Selectors**: Uses various CSS selectors to find content across different page layouts

## Troubleshooting

### Common Issues

**No posts found for profile**
- Verify the profile URL is correct and accessible
- Check if the user has public posts
- Some profiles may require different scraping methods

**Download failures**
- Check internet connection
- Verify kemono.cr is accessible
- Increase retry attempts in configuration
- Reduce concurrent downloads if experiencing timeouts

**"Cannot call write after a stream was destroyed" error**
- This has been fixed in the latest version
- Ensure you're using the updated fileUtils.js

**API failures**
- The application automatically falls back to HTML scraping
- Some content may only be available through specific methods

### Debug Information

The application provides extensive logging:
- Download progress and statistics
- Error messages with detailed context
- API vs HTML scraping status
- File existence and integrity checks

### Performance Tuning

For better performance:
- Increase `maxConcurrentImages` (but not above 5-10)
- Decrease delays if server allows
- Use SSD storage for faster file operations

For server-friendly downloads:
- Decrease `maxConcurrentImages` to 1-2
- Increase delays between requests
- Reduce retry attempts

## Dependencies

- **axios**: HTTP client for API requests and downloads
- **cheerio**: Server-side jQuery implementation for HTML parsing
- **fs-extra**: Enhanced file system operations

## License

This project is for educational and personal use only. Please respect kemono.cr's terms of service and be mindful of server resources.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Suggested Improvements

Based on code review and analysis, here are prioritized improvements to enhance the project:

### High Priority

#### Testing & Quality ✅ Target Achieved: 87%+ Coverage
- **Excellent test coverage across all critical components**:
  - `concurrentDownloader.js` (98.64% statements) ✅ - Comprehensive tests for semaphore logic, error handling, and concurrency
  - `fileUtils.js` (95.38% statements) ✅ - Complete coverage of stream handling, retry logic, and file operations
  - `KemonoDownloader.js` (91.58% statements) ✅ - Integration tests for complete download workflows
  - `kemonoApi.js` (88% statements) ✅ - Full coverage of pagination, rate limiting, and error scenarios
  - `imageExtractor.js` (89.51% statements) ✅ - Comprehensive media extraction tests
  - `urlUtils.js` (100% statements) ✅ - Complete URL validation and parsing coverage
  - `config.js` (98.21% statements) ✅ - Configuration management fully tested
  - `delay.js` (100% statements) ✅ - Full coverage
- **Overall Project Coverage**: 87.27% statements, 84.21% functions, 88.51% lines
- **Add integration tests** with real API calls using recorded responses
- **Add E2E tests** for complete download scenarios

#### Error Handling & Resilience
- Implement **circuit breaker pattern** for API calls to prevent cascade failures
- Add **retry with exponential backoff** for transient network errors (partially implemented)
- Implement **request timeout controls** with graceful degradation
- Add **structured logging** with log levels (debug, info, warn, error) to file
- Better error messages with **actionable suggestions** for common failures

#### Performance Optimization
- Implement **HTTP connection pooling** to reuse connections (currently creates new connections)
- Add **response caching** for API calls to reduce redundant requests
- Use **streaming downloads** for very large files to reduce memory usage
- Add **checksum verification** (MD5/SHA256) to detect corrupted downloads
- Implement **download resume** from partial files using HTTP Range headers

### Medium Priority

#### Code Quality & Maintainability
- **Refactor large functions**: Break down `downloadPost()` (108 lines) into smaller, testable units
- **Add JSDoc annotations** for better IDE support and type safety
- **Extract magic numbers** to named constants (delays, timeouts, retry attempts)
- **Use ES6 modules** instead of CommonJS for modern JavaScript features
- **Implement dependency injection** pattern for easier testing and mocking

#### User Experience Enhancements
- **CLI argument parsing** using `commander.js` or `yargs`:
  ```bash
  kemono-downloader --profile "url" --output "./downloads" --concurrent 5
  ```
- **Interactive mode** for profile selection and configuration
- **Better progress indicators**:
  - Real-time download speed (KB/s, MB/s)
  - ETA for remaining downloads
  - Individual file progress bars
- **Dry-run mode** to preview what would be downloaded without actually downloading
- **Filtering options**: Download only specific date ranges, file types, or post IDs
- **Download history export** to CSV/JSON for tracking and analysis

#### Security Enhancements
- **Content-type verification**: Ensure downloaded files match expected MIME types
- **File size limits**: Prevent downloading unexpectedly large files
- **Enhanced path sanitization**: Additional checks against directory traversal attacks
- **Rate limiting feedback**: Detect and handle 429 (Too Many Requests) responses
- **Suspicious file detection**: Warn about unexpected file types or sizes

### Low Priority

#### Advanced Features
- **Database storage** (SQLite) for download tracking instead of filesystem checks
  - Faster lookups for "already downloaded" checks
  - Query download history
  - Track download statistics over time
- **Download scheduling**: Set time windows for downloads
- **Cloud storage support**: Direct upload to S3, Google Cloud Storage, etc.
- **Duplicate detection**: Find and remove duplicate images across posts using perceptual hashing
- **Web UI dashboard**: Browser-based interface for monitoring and control
- **Docker containerization**: Easy deployment and isolation
- **Webhook notifications**: Send alerts to Discord, Telegram, Slack on completion or errors
- **Multi-language support**: Internationalization (i18n) for global users

#### Developer Experience
- **Pre-commit hooks**: Automated linting and testing before commits
- **Continuous Integration**: GitHub Actions for automated testing
- **Code coverage badges**: Display coverage metrics in README
- **API documentation**: Generate docs from JSDoc comments
- **Architecture diagrams**: Visual representation of system components
- **Examples directory**: Sample configurations and use cases
- **Contribution guidelines**: CONTRIBUTING.md with development workflow

### Quick Wins (Easy Improvements)

These can be implemented quickly with high impact:

1. **Add `.nvmrc` file** for Node.js version consistency
2. **Add `.editorconfig`** for consistent code formatting across editors
3. **Add ESLint configuration** for code quality enforcement
4. **Add Prettier** for automatic code formatting
5. **Extract configuration** to environment variables (`.env` file support)
6. **Add `--version` and `--help` flags** to CLI
7. **Add download summary export** (save stats to JSON file)
8. **Add `--validate-config` command** to check config.json syntax
9. **Add bandwidth throttling** option to limit download speed
10. **Add retry queue visualization** showing what's being retried

### Technical Debt

Items that should be addressed to improve long-term maintainability:

- **Replace console.log with proper logger** (winston, pino, or bunyan)
- **Implement proper event emitters** for progress tracking instead of callbacks
- **Standardize error types** with custom error classes
- **Remove hardcoded kemono.cr references** to support other similar sites
- **Separate concerns**: Split KemonoDownloader into smaller, focused classes
- **Add graceful shutdown** handling for SIGINT/SIGTERM signals
- **Memory profiling**: Identify and fix memory leaks in long-running downloads

### Metrics & Monitoring

Add observability to understand system behavior:

- **Download statistics dashboard**: Success rate, average speed, error types
- **Performance metrics**: Response times, queue depths, memory usage
- **Health checks**: Endpoint to verify system status
- **Alert thresholds**: Notify when error rate exceeds acceptable levels

## Changelog

### Latest Version
- Fixed stream destruction error in download handling
- Improved error handling and recovery
- Enhanced concurrent download management
- Better progress tracking and logging
