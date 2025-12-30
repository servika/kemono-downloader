const { fetchPage, fetchPostsFromAPI, fetchPostFromAPI } = require('../../src/api/kemonoApi');
const { delay } = require('../../src/utils/delay');
const config = require('../../src/utils/config');
const browserClient = require('../../src/utils/browserClient');

jest.mock('../../src/utils/delay');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/browserClient');

describe('kemonoApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    config.getRetryAttempts.mockReturnValue(2);
    config.getRetryDelay.mockReturnValue(100);
    config.getAPIDelay.mockReturnValue(0);
    config.getUserAgent.mockReturnValue('test-agent');
    config.getTimeout.mockReturnValue(5000);
    config.getBaseUrl.mockReturnValue('https://kemono.cr');
    config.getConfigValue = jest.fn().mockReturnValue(1000); // default delay between pages

    delay.mockResolvedValue();
  });

  describe('fetchPage', () => {
    test('should fetch page successfully via browser client', async () => {
      const mockHtml = '<html><body>Test content</body></html>';
      browserClient.fetchRenderedPage.mockResolvedValue(mockHtml);

      const result = await fetchPage('https://example.com');

      expect(browserClient.fetchRenderedPage).toHaveBeenCalledWith('https://example.com', undefined);
      expect(result).toBe(mockHtml);
    });

    test('should return null on fetch failure', async () => {
      browserClient.fetchRenderedPage.mockRejectedValue(new Error('Browser error'));

      const result = await fetchPage('https://example.com');

      expect(result).toBeNull();
    });

    test('should call onLog callback with messages', async () => {
      const mockHtml = '<html><body>Test</body></html>';
      browserClient.fetchRenderedPage.mockResolvedValue(mockHtml);
      const mockOnLog = jest.fn();

      await fetchPage('https://example.com', mockOnLog);

      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Fetching: https://example.com'));
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Page loaded successfully'));
    });
  });

  describe('fetchPostsFromAPI', () => {
    test('should fetch posts from API (no pagination support)', async () => {
      const mockProfileData = { name: 'Test/User' };
      const mockPostsData = [
        { id: '123', title: 'Post 1' },
        { id: '456' }
      ];

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockResolvedValueOnce({ data: mockProfileData })
        .mockResolvedValueOnce({ data: mockPostsData });

      const result = await fetchPostsFromAPI('patreon', '12345');

      expect(browserClient.navigateToPage).toHaveBeenCalledTimes(1);
      expect(browserClient.fetchJSON).toHaveBeenCalledTimes(2); // Profile + posts, no pagination
      expect(result).toEqual([
        {
          url: 'https://kemono.cr/patreon/user/12345/post/123',
          id: '123',
          username: 'Test_User',
          title: 'Post 1'
        },
        {
          url: 'https://kemono.cr/patreon/user/12345/post/456',
          id: '456',
          username: 'Test_User',
          title: 'Untitled'
        }
      ]);
    });

    test('should handle response with nested posts array', async () => {
      const mockResponse = {
        posts: [
          { id: '111', title: 'Nested Post' }
        ]
      };

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: mockResponse });

      const result = await fetchPostsFromAPI('patreon', '99999');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('111');
      expect(result[0].title).toBe('Nested Post');
    });

    test('should handle response with nested data array', async () => {
      const mockResponse = {
        data: [
          { id: '222', title: 'Data Nested Post' }
        ]
      };

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: mockResponse });

      const result = await fetchPostsFromAPI('fanbox', '88888');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('222');
    });

    test('should skip unexpected response formats and continue', async () => {
      const mockOnLog = jest.fn();
      const mockGoodResponse = [{ id: '333', title: 'Good Post' }];

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: { unexpected: 'format' } }) // Bad format
        .mockResolvedValueOnce({ data: mockGoodResponse }); // Good format

      const result = await fetchPostsFromAPI('patreon', '77777', mockOnLog);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('333');
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Unexpected response format'));
    });

    test('should fallback to userId when profile lookup fails', async () => {
      const mockResponse = {
        data: [
          { id: '789', title: 'Post 3' }
        ]
      };

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockResolvedValueOnce({ data: mockResponse });

      const result = await fetchPostsFromAPI('fanbox', '67890');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('789');
      expect(result[0].username).toBe('user_67890');
    });

    test('should call onLog with progress messages', async () => {
      const mockOnLog = jest.fn();
      config.getRetryAttempts.mockReturnValue(1);
      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('HTTP 500 Server Error'))
        .mockRejectedValueOnce(new Error('HTTP 500 Server Error'))
        .mockRejectedValueOnce(new Error('HTTP 500 Server Error'))
        .mockRejectedValueOnce(new Error('HTTP 500 Server Error'));

      await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Fetching profile info'));
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Trying API'));
    });

    test('should handle API errors with retry and logging', async () => {
      const mockOnLog = jest.fn();
      const mockPostsData = [{ id: '111', title: 'Test Post' }];

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockRejectedValueOnce(new Error('HTTP 500 Server Error'))
        .mockResolvedValueOnce({ data: mockPostsData });

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(result).toHaveLength(1);
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Trying API'));
    });

    test('should handle empty posts array', async () => {
      const mockOnLog = jest.fn();

      browserClient.navigateToPage.mockResolvedValueOnce();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockResolvedValueOnce({ data: [] });

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(result).toEqual([]);
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Trying API'));
    });
  });

  describe('fetchPostFromAPI', () => {
    test('should try multiple API URL patterns', async () => {
      const post = {
        url: 'https://kemono.cr/patreon/user/12345/post/123',
        id: '123'
      };

      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
        .mockResolvedValueOnce({ data: { id: '123' } });

      const result = await fetchPostFromAPI(post);

      expect(browserClient.fetchJSON).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: '123' });
      expect(delay).toHaveBeenCalledWith(500);
    });

    test('should return null when all API attempts fail', async () => {
      const post = {
        url: 'https://kemono.cr/patreon/user/12345/post/123',
        id: '123'
      };

      browserClient.fetchJSON.mockRejectedValue(new Error('HTTP 500 Server Error'));

      const result = await fetchPostFromAPI(post);

      expect(result).toBeNull();
    });

    test('should call onLog with progress messages', async () => {
      const mockOnLog = jest.fn();
      const post = {
        url: 'https://kemono.cr/patreon/user/12345/post/123',
        id: '123'
      };

      browserClient.fetchJSON.mockRejectedValue(new Error('HTTP 404 Not Found'));

      await fetchPostFromAPI(post, mockOnLog);

      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Trying post API'));
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Post API failed'));
    });

    test('should handle errors and return null', async () => {
      const post = {
        url: 'https://kemono.cr/patreon/user/12345/post/123',
        id: '123'
      };
      const mockOnLog = jest.fn();

      // Mock to reject all calls
      browserClient.fetchJSON.mockRejectedValue(new Error('Network error'));

      const result = await fetchPostFromAPI(post, mockOnLog);

      expect(result).toBeNull();
      // The error is caught and handled, just verify null return
    });
  });

  describe('fetchPostsFromAPI - pagination scenarios', () => {
    beforeEach(() => {
      config.getConfigValue.mockReturnValue(100); // delayBetweenPages
    });

    test('should handle pagination when exactly 50 posts are returned', async () => {
      const mockOnLog = jest.fn();

      // Create mock for exactly 50 posts on first page
      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      // Second page with 10 posts
      const secondPagePosts = Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 51),
        title: `Post ${i + 51}`
      }));

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found')) // v1 profile
        .mockRejectedValueOnce(new Error('Profile not found')) // v2 profile
        .mockResolvedValueOnce({ data: firstPagePosts }) // First page
        .mockResolvedValueOnce({ data: secondPagePosts }) // Second page with offset
        .mockResolvedValueOnce({ data: [] }); // Third page empty

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(result.length).toBe(60); // 50 + 10
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Got exactly 50 posts'));
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Pagination complete'));
    });

    test('should stop pagination when empty page is encountered', async () => {
      const mockOnLog = jest.fn();

      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: firstPagePosts }) // First page
        .mockResolvedValueOnce({ data: [] }); // Second page empty

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(result.length).toBe(50);
      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Page 2 is empty'));
    });

    test('should skip duplicate posts during pagination', async () => {
      const mockOnLog = jest.fn();

      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      // Second page has some duplicates from first page
      const secondPagePosts = [
        { id: '50', title: 'Post 50' }, // Duplicate
        { id: '51', title: 'Post 51' }, // New
        { id: '52', title: 'Post 52' }  // New
      ];

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: firstPagePosts })
        .mockResolvedValueOnce({ data: secondPagePosts })
        .mockResolvedValueOnce({ data: [] });

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      // Should be 50 from first page + 2 new from second page (1 duplicate skipped)
      expect(result.length).toBe(52);
    });

    test('should try different pagination parameter formats', async () => {
      const mockOnLog = jest.fn();

      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      const secondPagePosts = [
        { id: '51', title: 'Post 51' }
      ];

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: firstPagePosts }) // First page
        .mockRejectedValueOnce(new Error('404')) // ?o=50 fails
        .mockRejectedValueOnce(new Error('404')) // ?offset=50 fails
        .mockResolvedValueOnce({ data: secondPagePosts }) // ?page=2 works
        .mockResolvedValueOnce({ data: [] });

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(result.length).toBe(51);
    });

    test('should handle nested posts array in pagination', async () => {
      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      const secondPageResponse = {
        posts: [
          { id: '51', title: 'Nested Post 51' }
        ]
      };

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: firstPagePosts })
        .mockResolvedValueOnce({ data: secondPageResponse })
        .mockResolvedValueOnce({ data: [] });

      const result = await fetchPostsFromAPI('patreon', '12345');

      expect(result.length).toBe(51);
      expect(result[50].title).toBe('Nested Post 51');
    });

    test('should handle nested data array in pagination', async () => {
      const firstPagePosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      const secondPageResponse = {
        data: [
          { id: '51', title: 'Data Nested Post 51' }
        ]
      };

      browserClient.navigateToPage.mockResolvedValue();
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: firstPagePosts })
        .mockResolvedValueOnce({ data: secondPageResponse })
        .mockResolvedValueOnce({ data: [] });

      const result = await fetchPostsFromAPI('patreon', '12345');

      expect(result.length).toBe(51);
      expect(result[50].title).toBe('Data Nested Post 51');
    });

    test('should hit safety limit at 100 pages', async () => {
      const mockOnLog = jest.fn();

      // Mock infinite pagination scenario
      const pageWithPosts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        title: `Post ${i + 1}`
      }));

      browserClient.navigateToPage.mockResolvedValue();

      // First page
      browserClient.fetchJSON
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockRejectedValueOnce(new Error('Profile not found'))
        .mockResolvedValueOnce({ data: pageWithPosts });

      // Keep returning posts for pagination (would be infinite without safety limit)
      for (let i = 0; i < 200; i++) {
        browserClient.fetchJSON.mockResolvedValueOnce({ data: [{ id: String(1000 + i) }] });
      }

      const result = await fetchPostsFromAPI('patreon', '12345', mockOnLog);

      expect(mockOnLog).toHaveBeenCalledWith(expect.stringContaining('Reached safety limit of 100 pages'));
      expect(result.length).toBeLessThan(5100); // Should stop at 100 pages
    });
  });
});
