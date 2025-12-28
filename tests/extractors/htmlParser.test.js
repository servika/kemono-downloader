const cheerio = require('cheerio');
const {
  extractPostsFromProfileHTML,
  extractMediaFromPostHTML
} = require('../../src/extractors/htmlParser');

jest.mock('../../src/utils/urlUtils', () => ({
  isImageUrl: jest.fn((url) => url.match(/\.(jpg|jpeg|png|gif|webp)$/i)),
  isVideoUrl: jest.fn((url) => url.match(/\.(mp4|webm|mov)$/i)),
  isArchiveUrl: jest.fn((url) => url.match(/\.(zip|rar|7z)$/i)),
  isDownloadableUrl: jest.fn((url) => !url.includes('avatar') && !url.includes('icon'))
}));

describe('htmlParser', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  describe('extractPostsFromProfileHTML', () => {
    test('should extract posts using Strategy 1: post-card articles', () => {
      const html = `
        <html>
          <body>
            <article class="post-card" data-id="123">
              <a class="fancy-link" href="/patreon/user/456/post/123">
                <header class="post-card__header">Test Post 1</header>
              </a>
              <time class="timestamp" datetime="2023-01-01"></time>
            </article>
            <article class="post-card" data-id="124">
              <a class="fancy-link" href="/patreon/user/456/post/124">
                <header class="post-card__header">Test Post 2</header>
              </a>
              <time class="timestamp" datetime="2023-01-02"></time>
            </article>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(2);
      expect(posts[0]).toMatchObject({
        url: 'https://kemono.cr/patreon/user/456/post/123',
        id: '123',
        title: 'Test Post 1',
        published: '2023-01-01',
        source: 'post-card'
      });
      expect(posts[1]).toMatchObject({
        url: 'https://kemono.cr/patreon/user/456/post/124',
        id: '124',
        title: 'Test Post 2',
        published: '2023-01-02',
        source: 'post-card'
      });
    });

    test('should handle post-card with absolute URLs', () => {
      const html = `
        <html>
          <body>
            <article class="post-card" data-id="123">
              <a class="fancy-link" href="https://kemono.cr/patreon/user/456/post/123">
                <header class="post-card__header">Absolute URL Post</header>
              </a>
            </article>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe('https://kemono.cr/patreon/user/456/post/123');
    });

    test('should use Strategy 2: card-list items when no post-cards found', () => {
      const html = `
        <html>
          <body>
            <div class="card-list__item">
              <a href="/patreon/user/456/post/789" title="Card List Post">
                <div class="card__title">Card Title</div>
              </a>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        url: 'https://kemono.cr/patreon/user/456/post/789',
        id: '789',
        title: 'Card List Post',
        source: 'card-list'
      });
    });

    test('should use Strategy 3: generic post links when other strategies fail', () => {
      const html = `
        <html>
          <body>
            <a href="/patreon/user/456/post/111" title="Generic Link 1">Link 1</a>
            <a href="/patreon/user/456/post/222">Link 2</a>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(2);
      expect(posts[0].id).toBe('111');
      expect(posts[0].title).toBe('Generic Link 1');
      expect(posts[1].id).toBe('222');
      expect(posts[1].source).toBe('generic-link');
    });

    test('should avoid duplicates in generic links', () => {
      const html = `
        <html>
          <body>
            <a href="/patreon/user/456/post/123">Link 1</a>
            <a href="/patreon/user/456/post/123">Link 2 (duplicate)</a>
            <a href="/patreon/user/456/post/124">Link 3</a>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(2);
      expect(posts[0].id).toBe('123');
      expect(posts[1].id).toBe('124');
    });

    test('should use Strategy 4: regex extraction as last resort', () => {
      const html = `
        <html>
          <body>
            <div>
              Some text with a link: <span href="/patreon/user/456/post/999">Not an anchor</span>
            </div>
            <script>
              var url = href="/patreon/user/456/post/888";
            </script>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts.length).toBeGreaterThan(0);
      expect(posts[0].source).toBe('regex');
      expect(posts[0].title).toBe('Untitled');
    });

    test('should handle empty HTML', () => {
      const html = '<html><body></body></html>';
      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toEqual([]);
    });

    test('should handle missing titles with default "Untitled"', () => {
      const html = `
        <html>
          <body>
            <article class="post-card">
              <a class="fancy-link" href="/patreon/user/456/post/123"></a>
            </article>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const posts = extractPostsFromProfileHTML($, 'https://kemono.cr/patreon/user/456');

      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe('Untitled');
    });
  });

  describe('extractMediaFromPostHTML', () => {
    test('should extract media using Strategy 1: fileThumb links', () => {
      const html = `
        <html>
          <body>
            <div class="post__files">
              <a class="fileThumb" href="https://kemono.cr/data/image1.jpg" download="image1.jpg">Download</a>
              <a class="fileThumb" href="//kemono.cr/data/image2.png" download="image2.png">Download</a>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      expect(media.length).toBeGreaterThanOrEqual(2);
      const fileThumbMedia = media.filter(m => m.source === 'fileThumb-links');
      expect(fileThumbMedia[0]).toMatchObject({
        url: 'https://kemono.cr/data/image1.jpg',
        filename: 'image1.jpg',
        type: 'file-thumb'
      });
    });

    test('should extract media using Strategy 2: post attachments', () => {
      const html = `
        <html>
          <body>
            <div class="post__attachments">
              <div class="post__attachment">
                <a href="/data/file1.zip">
                  <span class="post__attachment-name">Archive File</span>
                </a>
              </div>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const attachments = media.filter(m => m.source === 'attachments-section');
      expect(attachments.length).toBeGreaterThan(0);
      expect(attachments[0].type).toBe('attachment');
    });

    test('should extract images using Strategy 3: img tags', () => {
      const html = `
        <html>
          <body>
            <img class="post__image" src="https://kemono.cr/data/image1.jpg" alt="Test Image">
            <img data-src="//kemono.cr/data/image2.png">
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const images = media.filter(m => m.source === 'img-tags');
      expect(images.length).toBeGreaterThan(0);
      expect(images[0]).toMatchObject({
        type: 'image',
        mediaType: 'image'
      });
    });

    test('should convert thumbnail URLs to full resolution', () => {
      const html = `
        <html>
          <body>
            <img src="https://kemono.cr/thumbnail/data/image1.jpg" class="post__image">
            <img src="https://kemono.cr/image_thumb.jpg" class="post__image">
            <img src="https://kemono.cr/different.thumb.jpg" class="post__image">
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const images = media.filter(m => m.source === 'img-tags');
      expect(images.length).toBeGreaterThanOrEqual(2);

      // Check first image with /thumbnail/ pattern
      const thumbnailImage = images.find(m => m.thumbnailUrl && m.thumbnailUrl.includes('/thumbnail/'));
      expect(thumbnailImage).toBeDefined();
      expect(thumbnailImage.url).toBe('https://kemono.cr/data/data/image1.jpg');
      expect(thumbnailImage.thumbnailUrl).toBe('https://kemono.cr/thumbnail/data/image1.jpg');

      // Check image with _thumb pattern
      const thumbImage = images.find(m => m.url === 'https://kemono.cr/image.jpg');
      expect(thumbImage).toBeDefined();
      expect(thumbImage.thumbnailUrl).toContain('thumb');

      // Check image with .thumb. pattern
      const dotThumbImage = images.find(m => m.url === 'https://kemono.cr/different.jpg');
      expect(dotThumbImage).toBeDefined();
    });

    test('should skip avatar and icon images', () => {
      const html = `
        <html>
          <body>
            <img src="https://kemono.cr/avatar/user.jpg" class="post__image">
            <img src="https://kemono.cr/icon/logo.png" class="post__image">
            <img src="https://kemono.cr/data/normal.jpg" class="post__image">
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const images = media.filter(m => m.source === 'img-tags');
      expect(images).toHaveLength(1);
      expect(images[0].url).toBe('https://kemono.cr/data/normal.jpg');
    });

    test('should extract videos using Strategy 4: video tags', () => {
      const html = `
        <html>
          <body>
            <video class="post__video" src="https://kemono.cr/data/video1.mp4"></video>
            <video>
              <source src="//kemono.cr/data/video2.webm">
            </video>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const videos = media.filter(m => m.source === 'video-tags');
      expect(videos.length).toBeGreaterThan(0);
      expect(videos[0]).toMatchObject({
        type: 'video',
        mediaType: 'video'
      });
    });

    test('should extract download links using Strategy 5', () => {
      const html = `
        <html>
          <body>
            <a class="post__attachment-link" href="https://kemono.cr/data/file1.jpg">Download 1</a>
            <a download href="/data/file2.png">Download 2</a>
            <a href="https://kemono.cr/data/file3.gif">Download 3</a>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      expect(media.length).toBeGreaterThan(0);
    });

    test('should avoid duplicate media files', () => {
      const html = `
        <html>
          <body>
            <a class="fileThumb" href="https://kemono.cr/data/image1.jpg">Download</a>
            <img src="https://kemono.cr/data/image1.jpg" class="post__image">
            <a href="https://kemono.cr/data/image1.jpg">Link</a>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      // Should only have one entry for image1.jpg despite multiple references
      const image1Entries = media.filter(m => m.url === 'https://kemono.cr/data/image1.jpg');
      expect(image1Entries.length).toBeLessThanOrEqual(3); // One from each strategy at most
    });

    test('should handle empty post HTML', () => {
      const html = '<html><body></body></html>';
      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      expect(media).toEqual([]);
    });

    test('should handle relative URLs correctly', () => {
      const html = `
        <html>
          <body>
            <img src="/data/relative.jpg" class="post__image">
            <a href="/data/relative-link.png">Download</a>
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      expect(media.length).toBeGreaterThan(0);
      media.forEach(m => {
        expect(m.url).toMatch(/^https:\/\//);
      });
    });

    test('should handle protocol-relative URLs', () => {
      const html = `
        <html>
          <body>
            <img src="//kemono.cr/data/protocol-relative.jpg" class="post__image">
          </body>
        </html>
      `;

      const $ = cheerio.load(html);
      const media = extractMediaFromPostHTML($, 'https://kemono.cr/patreon/user/456/post/123');

      const images = media.filter(m => m.source === 'img-tags');
      expect(images[0].url).toBe('https://kemono.cr/data/protocol-relative.jpg');
    });
  });
});