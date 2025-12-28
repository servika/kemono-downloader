const KemonoDownloader = require('../src/KemonoDownloader');
const config = require('../src/utils/config');
const { extractUserInfo, extractProfileName } = require('../src/utils/urlUtils');
const { savePostMetadata, saveHtmlContent, readProfilesFile } = require('../src/utils/fileUtils');
const { fetchPage, fetchPostsFromAPI, fetchPostFromAPI } = require('../src/api/kemonoApi');
const { extractImagesFromPostData, extractImagesFromHTML } = require('../src/extractors/imageExtractor');
const { isPostAlreadyDownloaded, getDownloadStatus, verifyAllImagesDownloaded } = require('../src/utils/downloadChecker');
const ConcurrentDownloader = require('../src/utils/concurrentDownloader');
const browserClient = require('../src/utils/browserClient');
const fs = require('fs-extra');
const cheerio = require('cheerio');

jest.mock('../src/utils/config');
jest.mock('../src/utils/urlUtils');
jest.mock('../src/utils/fileUtils');
jest.mock('../src/api/kemonoApi');
jest.mock('../src/extractors/imageExtractor');
jest.mock('../src/utils/downloadChecker');
jest.mock('../src/utils/concurrentDownloader');
jest.mock('../src/utils/browserClient');
jest.mock('fs-extra');
jest.mock('cheerio');

// Helper function to create cheerio mock with consistent structure
function createCheerioMock(bodyContent = 'normal html', fullHtml = '<html><body>normal html</body></html>') {
  const elementMock = {
    text: jest.fn().mockReturnValue(bodyContent),
    find: jest.fn().mockReturnThis(),
    first: jest.fn().mockReturnThis(),
    attr: jest.fn(),
    is: jest.fn().mockReturnValue(false),
    each: jest.fn(),
    html: jest.fn().mockReturnValue(fullHtml)
  };

  const $ = jest.fn((selector) => {
    if (selector === 'body') {
      return {
        text: jest.fn().mockReturnValue(bodyContent),
        html: jest.fn().mockReturnValue(fullHtml)
      };
    }
    return elementMock;
  });

  // Manually copy properties instead of Object.assign to avoid read-only properties
  $.text = elementMock.text;
  $.find = elementMock.find;
  $.first = elementMock.first;
  $.attr = elementMock.attr;
  $.is = elementMock.is;
  $.each = elementMock.each;
  $.html = elementMock.html;

  return $;
}

describe('KemonoDownloader', () => {
  let downloader;
  let mockConcurrentDownloader;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock config
    config.load.mockResolvedValue();
    config.getBaseDirectory.mockReturnValue('/test/downloads');
    config.getMaxConcurrentImages.mockReturnValue(3);
    config.getImageDelay.mockReturnValue(200);
    
    // Mock URL utils
    extractUserInfo.mockReturnValue({ userId: '123', service: 'patreon' });
    extractProfileName.mockReturnValue('testuser');

    // Mock ConcurrentDownloader
    mockConcurrentDownloader = {
      downloadImages: jest.fn().mockImplementation(async (images, postDir, onProgress, onComplete) => {
        const stats = { completed: 1, failed: 0, skipped: 0 };
        if (onComplete) {
          onComplete(stats);
        }
        return stats;
      })
    };
    ConcurrentDownloader.mockImplementation(() => mockConcurrentDownloader);

    // Mock console.log and console.error to reduce test noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    downloader = new KemonoDownloader();
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe('constructor', () => {
    test('should initialize with correct defaults', () => {
      expect(downloader.baseDir).toBe('/test/downloads');
      expect(downloader.stats).toEqual({
        profilesProcessed: 0,
        postsDownloaded: 0,
        postsSkipped: 0,
        imagesDownloaded: 0,
        errors: 0
      });
    });
  });

  describe('initialize', () => {
    test('should load configuration and update base directory', async () => {
      config.getBaseDirectory.mockReturnValue('/custom/downloads');
      
      await downloader.initialize();
      
      expect(config.load).toHaveBeenCalled();
      expect(downloader.baseDir).toBe('/custom/downloads');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Base directory: /custom/downloads'));
    });
  });

  describe('getProfilePosts', () => {
    test('should get posts from HTML successfully', async () => {
      const profileUrl = 'https://kemono.cr/patreon/user/123';
      const mockPosts = [
        { id: '1', url: 'https://kemono.cr/patreon/user/123/post/1', username: 'testuser' }
      ];

      extractUserInfo.mockReturnValue({ userId: '123', service: 'patreon' });
      downloader.getProfilePostsFromHTML = jest.fn().mockResolvedValue(mockPosts);

      const result = await downloader.getProfilePosts(profileUrl);

      expect(result).toEqual(mockPosts);
      expect(downloader.getProfilePostsFromHTML).toHaveBeenCalledWith(profileUrl);
      expect(fetchPostsFromAPI).not.toHaveBeenCalled();
    });

    test('should fallback to API when HTML scraping fails', async () => {
      const profileUrl = 'https://kemono.cr/patreon/user/123';
      const mockPosts = [
        { id: '1', url: 'https://kemono.cr/patreon/user/123/post/1', username: 'testuser' }
      ];

      extractUserInfo.mockReturnValue({ userId: '123', service: 'patreon' });
      downloader.getProfilePostsFromHTML = jest.fn().mockResolvedValue([]);
      fetchPostsFromAPI.mockResolvedValue(mockPosts);

      const result = await downloader.getProfilePosts(profileUrl);

      expect(result).toEqual(mockPosts);
      expect(downloader.getProfilePostsFromHTML).toHaveBeenCalledWith(profileUrl);
      expect(fetchPostsFromAPI).toHaveBeenCalledWith('patreon', '123', expect.any(Function));
    });
  });

  describe('getProfilePostsFromHTML', () => {
    test('should extract posts from HTML', async () => {
      const profileUrl = 'https://kemono.cr/patreon/user/123';
      const mockHtml = '<html><body><article class="post-card"><a href="/patreon/user/123/post/456">Post</a></article></body></html>';

      // Create chainable mock that supports .find().text()
      const textMock = jest.fn().mockReturnValue('Test Post Title');
      const findResultMock = {
        text: textMock,
        first: jest.fn().mockReturnThis(),
        attr: jest.fn().mockReturnValue('/patreon/user/123/post/456'),
        trim: jest.fn().mockReturnValue('Test Post Title')
      };

      const mock$ = jest.fn().mockReturnValue({
        text: jest.fn().mockReturnValue('normal html content'),
        length: 1,
        each: jest.fn().mockImplementation((callback) => {
          callback(0, { tagName: 'article' });
        }),
        find: jest.fn().mockReturnValue(findResultMock),
        is: jest.fn().mockReturnValue(false),
        attr: jest.fn().mockReturnValue('/patreon/user/123/post/456')
      });

      mock$.text = jest.fn().mockReturnValue('normal html content');
      mock$.first = jest.fn().mockReturnValue(mock$);
      mock$.trim = jest.fn().mockReturnValue('Test Post Title');
      mock$.attr = jest.fn().mockReturnValue('/patreon/user/123/post/456');
      mock$.find = jest.fn().mockReturnValue(findResultMock);
      mock$.is = jest.fn().mockReturnValue(false);
      mock$.substring = jest.fn().mockReturnValue('normal html content');
      mock$.length = 1;
      mock$.each = jest.fn().mockImplementation((callback) => {
        callback(0, { tagName: 'article' });
      });

      cheerio.load.mockReturnValue(mock$);
      fetchPage.mockResolvedValue(mockHtml);
      extractUserInfo.mockReturnValue({ userId: '123', service: 'patreon' });

      downloader.extractPostId = jest.fn().mockReturnValue('456');

      const result = await downloader.getProfilePostsFromHTML(profileUrl);

      expect(fetchPage).toHaveBeenCalledWith(profileUrl, expect.any(Function));
      expect(result.length).toBeGreaterThan(0);
    });

    test('should handle SPA detection', async () => {
      const profileUrl = 'https://kemono.cr/patreon/user/123';
      const mockHtml = '<html><body>System.import</body></html>';
      
      const mock$ = jest.fn().mockReturnValue({
        text: jest.fn().mockReturnValue('System.import and other SPA content')
      });
      mock$.text = jest.fn().mockReturnValue('System.import and other SPA content');
      mock$.substring = jest.fn().mockReturnValue('System.import');
      
      cheerio.load.mockReturnValue(mock$);
      fetchPage.mockResolvedValue(mockHtml);
      
      const result = await downloader.getProfilePostsFromHTML(profileUrl);
      
      expect(result).toEqual([]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Detected SPA'));
    });

    test('should handle HTML fetch failure', async () => {
      const profileUrl = 'https://kemono.cr/patreon/user/123';
      
      fetchPage.mockResolvedValue(null);
      
      const result = await downloader.getProfilePostsFromHTML(profileUrl);
      
      expect(result).toEqual([]);
    });
  });

  describe('extractPostId', () => {
    test('should extract post ID from URL', () => {
      expect(downloader.extractPostId('https://kemono.cr/patreon/user/123/post/456')).toBe('456');
      expect(downloader.extractPostId('https://example.com/posts/789')).toBe('789');
      expect(downloader.extractPostId('https://example.com/')).toBe('unknown');
    });
  });

  describe('downloadPost', () => {
    const mockPost = {
      id: '123',
      url: 'https://kemono.cr/patreon/user/456/post/123',
      username: 'testuser'
    };

    test('should skip already downloaded posts', async () => {
      getDownloadStatus.mockResolvedValue('completed');
      isPostAlreadyDownloaded.mockResolvedValue({ downloaded: true });

      await downloader.downloadPost(mockPost, 0, 1);

      expect(downloader.stats.postsSkipped).toBe(1);
      expect(fetchPage).not.toHaveBeenCalled();
    });

    test('should download post with HTML successfully', async () => {
      const mockHtml = '<html><body><img src="/image1.jpg"></body></html>';
      const mockImages = [
        { url: 'https://kemono.cr/image1.jpg' }
      ];

      getDownloadStatus.mockResolvedValue('not_started');
      isPostAlreadyDownloaded.mockResolvedValue({ downloaded: false });
      fetchPage.mockResolvedValue(mockHtml);
      cheerio.load.mockReturnValue(createCheerioMock('normal html content'));
      extractImagesFromHTML.mockReturnValue(mockImages);
      fs.ensureDir.mockResolvedValue();
      saveHtmlContent.mockResolvedValue();

      await downloader.downloadPost(mockPost, 0, 1);

      expect(saveHtmlContent).toHaveBeenCalledWith(expect.any(String), mockHtml, mockImages);
      expect(mockConcurrentDownloader.downloadImages).toHaveBeenCalledWith(
        mockImages,
        expect.any(String),
        expect.any(Function),
        expect.any(Function)
      );
      expect(downloader.stats.postsDownloaded).toBe(1);
      expect(fetchPostFromAPI).not.toHaveBeenCalled();
    });

    test('should handle partial downloads and resume', async () => {
      const mockPostData = {
        id: '123',
        title: 'Test Post'
      };
      const mockImages = [
        { url: 'https://example.com/image1.jpg' },
        { url: 'https://example.com/image2.jpg' }
      ];
      const mockHtml = '<html><body><img src="/image1.jpg"></body></html>';

      getDownloadStatus.mockResolvedValue('partial');
      isPostAlreadyDownloaded.mockResolvedValue({
        downloaded: false,
        missingImages: ['image2.jpg'],
        reason: 'Missing 1 image'
      });
      fetchPage.mockResolvedValue(mockHtml);
      cheerio.load.mockReturnValue(createCheerioMock('normal html content'));
      extractImagesFromHTML.mockReturnValue([]);
      fetchPostFromAPI.mockResolvedValue(mockPostData);
      extractImagesFromPostData.mockReturnValue(mockImages);
      fs.ensureDir.mockResolvedValue();
      savePostMetadata.mockResolvedValue();
      saveHtmlContent.mockResolvedValue();

      downloader.verifyPostImages = jest.fn().mockResolvedValue();

      await downloader.downloadPost(mockPost, 0, 1);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Resuming'));
      expect(mockConcurrentDownloader.downloadImages).toHaveBeenCalled();
    });

    test('should fallback to API when HTML fails', async () => {
      const mockPostData = {
        id: '123',
        title: 'Test Post',
        content: 'Post content'
      };
      const mockImages = [
        { url: 'https://example.com/image1.jpg' }
      ];
      const mockHtml = '<html><body></body></html>';

      getDownloadStatus.mockResolvedValue('not_started');
      isPostAlreadyDownloaded.mockResolvedValue({ downloaded: false });
      fetchPage.mockResolvedValue(mockHtml);
      cheerio.load.mockReturnValue(createCheerioMock('normal html content'));
      extractImagesFromHTML.mockReturnValue([]);
      fetchPostFromAPI.mockResolvedValue(mockPostData);
      extractImagesFromPostData.mockReturnValue(mockImages);
      fs.ensureDir.mockResolvedValue();
      savePostMetadata.mockResolvedValue();
      saveHtmlContent.mockResolvedValue();
      verifyAllImagesDownloaded.mockResolvedValue({ allPresent: true, presentCount: 1, totalExpected: 1 });

      downloader.verifyPostImages = jest.fn().mockResolvedValue();

      await downloader.downloadPost(mockPost, 0, 1);

      expect(fetchPage).toHaveBeenCalled();
      expect(fetchPostFromAPI).toHaveBeenCalled();
      expect(savePostMetadata).toHaveBeenCalledWith(expect.any(String), mockPostData);
      expect(mockConcurrentDownloader.downloadImages).toHaveBeenCalledWith(
        mockImages,
        expect.any(String),
        expect.any(Function),
        expect.any(Function)
      );
      expect(downloader.stats.postsDownloaded).toBe(1);
    });

    test('should handle SPA content in post page', async () => {
      const mockHtml = '<html><body>System.import</body></html>';

      getDownloadStatus.mockResolvedValue('not_started');
      isPostAlreadyDownloaded.mockResolvedValue({ downloaded: false });
      fetchPostFromAPI.mockResolvedValue(null);
      fetchPage.mockResolvedValue(mockHtml);
      cheerio.load.mockReturnValue(createCheerioMock('System.import and other SPA content'));
      browserClient.extractImagesFromRenderedPost.mockResolvedValue([]);
      fs.ensureDir.mockResolvedValue();
      saveHtmlContent.mockResolvedValue();

      await downloader.downloadPost(mockPost, 0, 1);

      expect(browserClient.extractImagesFromRenderedPost).toHaveBeenCalledWith(
        mockPost.url,
        expect.any(Function)
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Post page is a SPA'));
    });

    test('should handle post fetch failure', async () => {
      getDownloadStatus.mockResolvedValue('not_started');
      isPostAlreadyDownloaded.mockResolvedValue({ downloaded: false });
      fetchPage.mockResolvedValue(null);
      fetchPostFromAPI.mockResolvedValue(null);
      fs.ensureDir.mockResolvedValue();

      await downloader.downloadPost(mockPost, 0, 1);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Both HTML and API approaches failed'));
      expect(downloader.stats.postsDownloaded).toBe(1);
    });
  });

  describe('verifyPostImages', () => {
    test('should verify all images successfully', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' },
        { url: 'https://example.com/image2.jpg' }
      ];
      
      verifyAllImagesDownloaded.mockResolvedValue({
        allPresent: true,
        presentCount: 2,
        totalExpected: 2,
        missingFiles: [],
        corruptedFiles: []
      });
      
      await downloader.verifyPostImages('/test/post', mockImages, '123');
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verification passed'));
      expect(downloader.stats.errors).toBe(0);
    });

    test('should handle verification issues', async () => {
      const mockImages = [
        { url: 'https://example.com/image1.jpg' },
        { url: 'https://example.com/image2.jpg' }
      ];
      
      verifyAllImagesDownloaded.mockResolvedValue({
        allPresent: false,
        presentCount: 1,
        totalExpected: 2,
        missingCount: 1,
        missingFiles: ['image2.jpg'],
        corruptedFiles: []
      });
      
      await downloader.verifyPostImages('/test/post', mockImages, '123');
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verification issues found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Missing files (1)'));
      expect(downloader.stats.errors).toBe(1);
    });

    test('should handle verification errors', async () => {
      const mockImages = [{ url: 'https://example.com/image1.jpg' }];
      
      verifyAllImagesDownloaded.mockRejectedValue(new Error('Verification failed'));
      
      await downloader.verifyPostImages('/test/post', mockImages, '123');
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Verification failed'));
      expect(downloader.stats.errors).toBe(1);
    });
  });

  describe('processProfilesFile', () => {
    test('should process multiple profiles successfully', async () => {
      const profileUrls = [
        'https://kemono.cr/patreon/user/123',
        'https://kemono.cr/fanbox/user/456'
      ];
      const mockPosts = [
        { id: '1', url: 'https://kemono.cr/patreon/user/123/post/1', username: 'user1' }
      ];
      
      readProfilesFile.mockResolvedValue(profileUrls);
      downloader.getProfilePosts = jest.fn().mockResolvedValue(mockPosts);
      downloader.downloadPost = jest.fn().mockResolvedValue();
      
      await downloader.processProfilesFile('profiles.txt');
      
      expect(readProfilesFile).toHaveBeenCalledWith('profiles.txt');
      expect(downloader.getProfilePosts).toHaveBeenCalledTimes(2);
      expect(downloader.downloadPost).toHaveBeenCalledTimes(2); // 1 post from each profile
      expect(downloader.stats.profilesProcessed).toBe(2);
    });

    test('should handle profiles with no posts', async () => {
      const profileUrls = ['https://kemono.cr/patreon/user/123'];
      
      readProfilesFile.mockResolvedValue(profileUrls);
      downloader.getProfilePosts = jest.fn().mockResolvedValue([]);
      
      await downloader.processProfilesFile('profiles.txt');
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No posts found'));
      expect(downloader.stats.profilesProcessed).toBe(1);
    });

    test('should handle profile processing errors', async () => {
      const profileUrls = ['https://kemono.cr/patreon/user/123'];
      
      readProfilesFile.mockResolvedValue(profileUrls);
      downloader.getProfilePosts = jest.fn().mockRejectedValue(new Error('Profile error'));
      
      await downloader.processProfilesFile('profiles.txt');
      
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error processing profile'));
      expect(downloader.stats.errors).toBe(1);
    });

    test('should handle file reading errors', async () => {
      readProfilesFile.mockRejectedValue(new Error('File read error'));
      
      await downloader.processProfilesFile('nonexistent.txt');
      
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error processing profiles file'));
      expect(downloader.stats.errors).toBe(1);
    });
  });

  describe('printSummary', () => {
    test('should print successful summary', () => {
      downloader.stats = {
        profilesProcessed: 2,
        postsDownloaded: 10,
        postsSkipped: 3,
        imagesDownloaded: 50,
        errors: 0
      };
      
      downloader.printSummary();
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('DOWNLOAD SUMMARY'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Profiles processed: 2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Posts downloaded: 10'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Images downloaded: 50'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('All downloads completed successfully'));
    });

    test('should print summary with errors', () => {
      downloader.stats = {
        profilesProcessed: 1,
        postsDownloaded: 5,
        postsSkipped: 1,
        imagesDownloaded: 20,
        errors: 3
      };
      
      downloader.printSummary();
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Errors encountered: 3'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Some errors occurred'));
    });
  });
});
