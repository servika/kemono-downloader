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
  });
});
