const { isImageUrl, isVideoUrl, isArchiveUrl, isMediaUrl, isDownloadableUrl } = require('../utils/urlUtils');

/**
 * Media extraction utilities for images and videos
 */

function extractMediaFromPostData(postData) {
  const mediaFiles = [];
  
  try {
    // Handle the specific Kemono API response structure
    
    // 1. Extract from post.file (main file)
    if (postData.post?.file?.path) {
      const mainFileUrl = `https://kemono.cr${postData.post.file.path}`;
      if (isDownloadableUrl(mainFileUrl)) {
        const isVideo = isVideoUrl(mainFileUrl);
        const isArchive = isArchiveUrl(mainFileUrl);
        let mediaType = 'image';
        let emoji = '🖼️';
        
        if (isVideo) {
          mediaType = 'video';
          emoji = '🎥';
        } else if (isArchive) {
          mediaType = 'archive';
          emoji = '📦';
        }
        
        mediaFiles.push({
          url: mainFileUrl,
          filename: postData.post.file.name || null,
          type: 'main',
          mediaType
        });
        console.log(`    ${emoji}  Found main file: ${postData.post.file.name}`);
      }
    }
    
    // 2. Extract from post.attachments (additional files)
    if (postData.post?.attachments && Array.isArray(postData.post.attachments)) {
      for (const attachment of postData.post.attachments) {
        if (attachment.path && isDownloadableUrl(attachment.path)) {
          const attachmentUrl = `https://kemono.cr${attachment.path}`;
          const isVideo = isVideoUrl(attachmentUrl);
          const isArchive = isArchiveUrl(attachmentUrl);
          let mediaType = 'image';
          let emoji = '🖼️';
          
          if (isVideo) {
            mediaType = 'video';
            emoji = '🎥';
          } else if (isArchive) {
            mediaType = 'archive';
            emoji = '📦';
          }
          
          mediaFiles.push({
            url: attachmentUrl,
            filename: attachment.name || null,
            type: 'attachment',
            mediaType
          });
          console.log(`    ${emoji}  Found attachment: ${attachment.name}`);
        }
      }
    }
    
    // 3. Extract from previews section (with server URLs)
    if (postData.previews && Array.isArray(postData.previews)) {
      for (const preview of postData.previews) {
        if (preview.server && preview.path) {
          const previewUrl = `${preview.server}${preview.path}`;
          // Only add if we don't already have this image from main/attachments
          const isDuplicate = mediaFiles.some(media => media.url.includes(preview.path));
          if (!isDuplicate && isDownloadableUrl(previewUrl)) {
            const isVideo = isVideoUrl(previewUrl);
            const isArchive = isArchiveUrl(previewUrl);
            let mediaType = 'image';
            let emoji = '🖼️';
            
            if (isVideo) {
              mediaType = 'video';
              emoji = '🎥';
            } else if (isArchive) {
              mediaType = 'archive';
              emoji = '📦';
            }
            
            mediaFiles.push({
              url: previewUrl,
              filename: preview.name || null,
              type: 'preview',
              mediaType
            });
            console.log(`    ${emoji}  Found preview: ${preview.name} (${preview.type})`);
          }
        }
      }
    }
    
    // 4. Fallback: try legacy structure for compatibility
    const legacySources = [
      postData.file?.path,
      postData.attachments,
      postData.images,
      postData.content
    ];
    
    for (const source of legacySources) {
      if (!source) continue;
      
      if (typeof source === 'string') {
        // First try to treat as a direct path (for legacy file paths)
        if (source.startsWith('/') && isDownloadableUrl(source)) {
          const fullUrl = `https://kemono.cr${source}`;
          const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
          if (!alreadyExists) {
            const isVideo = isVideoUrl(fullUrl);
            const isArchive = isArchiveUrl(fullUrl);
            let mediaType = 'image';
            
            if (isVideo) {
              mediaType = 'video';
            } else if (isArchive) {
              mediaType = 'archive';
            }
            
            mediaFiles.push({
              url: fullUrl,
              filename: null,
              type: 'legacy',
              mediaType
            });
          }
        } else {
          // Extract downloadable URLs from content text
          const mediaMatches = source.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|avi|mov|wmv|flv|mkv|m4v|3gp|ogv|zip|rar|7z|tar)/gi);
          if (mediaMatches) {
            for (const match of mediaMatches) {
              const alreadyExists = mediaFiles.some(media => media.url === match);
              if (!alreadyExists) {
                const isVideo = isVideoUrl(match);
                const isArchive = isArchiveUrl(match);
                let mediaType = 'image';
                
                if (isVideo) {
                  mediaType = 'video';
                } else if (isArchive) {
                  mediaType = 'archive';
                }
                
                mediaFiles.push({
                  url: match,
                  filename: null,
                  type: 'content',
                  mediaType
                });
              }
            }
          }
        }
      } else if (Array.isArray(source)) {
        // Handle arrays of attachments/images
        for (const item of source) {
          if (typeof item === 'string' && isDownloadableUrl(item)) {
            const fullUrl = item.startsWith('http') ? item : `https://kemono.cr${item}`;
            const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
            if (!alreadyExists) {
              const isVideo = isVideoUrl(fullUrl);
              const isArchive = isArchiveUrl(fullUrl);
              let mediaType = 'image';
              
              if (isVideo) {
                mediaType = 'video';
              } else if (isArchive) {
                mediaType = 'archive';
              }
              
              mediaFiles.push({
                url: fullUrl,
                filename: null,
                type: 'legacy',
                mediaType
              });
            }
          } else if (item && typeof item === 'object') {
            // Handle attachment objects
            const attachmentUrl = item.path || item.url || item.src;
            if (attachmentUrl && isDownloadableUrl(attachmentUrl)) {
              const fullUrl = attachmentUrl.startsWith('http') ? attachmentUrl : `https://kemono.cr${attachmentUrl}`;
              const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
              if (!alreadyExists) {
                const isVideo = isVideoUrl(fullUrl);
                const isArchive = isArchiveUrl(fullUrl);
                let mediaType = 'image';
                
                if (isVideo) {
                  mediaType = 'video';
                } else if (isArchive) {
                  mediaType = 'archive';
                }
                
                mediaFiles.push({
                  url: fullUrl,
                  filename: item.name || null,
                  type: 'legacy',
                  mediaType
                });
              }
            }
          }
        }
      }
    }
    
    return mediaFiles;
    
  } catch (error) {
    console.log(`⚠️  Error extracting media from post data: ${error.message}`);
    return [];
  }
}

function extractMediaFromHTML($) {
  const mediaFiles = [];
  const addedUrls = new Set(); // Track URLs to avoid duplicates

  /**
   * Helper function to check if URL is a thumbnail
   */
  function isThumbnailUrl(url) {
    return url && (url.includes('/thumbnail/') || url.includes('img.kemono.cr/thumbnail'));
  }

  /**
   * Helper function to add media file if not duplicate or thumbnail
   */
  function addMediaFile(url, mediaType) {
    if (!url || isThumbnailUrl(url) || addedUrls.has(url)) {
      return false;
    }

    const fullUrl = url.startsWith('//') ? `https:${url}` :
                    url.startsWith('http') ? url :
                    `https://kemono.cr${url}`;

    // Double-check after normalization
    if (isThumbnailUrl(fullUrl) || addedUrls.has(fullUrl)) {
      return false;
    }

    addedUrls.add(fullUrl);
    mediaFiles.push({ url: fullUrl, mediaType, type: 'html' });
    return true;
  }

  // Priority 1: Extract full-size images from <a> tags wrapping images
  // These are the main image links (inlineThumb, fileThumb, image-link classes)
  $('a.inlineThumb, a.fileThumb, a.image-link').each((index, element) => {
    const href = $(element).attr('href');
    if (href && isDownloadableUrl(href)) {
      const isVideo = isVideoUrl(href);
      const mediaType = isVideo ? 'video' : 'image';
      addMediaFile(href, mediaType);
    }
  });

  // Priority 2: Extract from img tags in document order
  // For each img, try data-src first (may have full URL), then src
  $('.post__content img, .post__thumbnail img').each((index, element) => {
    // Try data-src first (may contain full-size URL)
    const dataSrc = $(element).attr('data-src');
    if (dataSrc && !isThumbnailUrl(dataSrc)) {
      addMediaFile(dataSrc, 'image');
      return; // Skip src if data-src was added
    }

    // Fallback to src attribute (skip if it's a thumbnail)
    const imgSrc = $(element).attr('src');
    if (imgSrc && !isThumbnailUrl(imgSrc)) {
      addMediaFile(imgSrc, 'image');
    }
  });

  // Priority 4: Find videos in post content
  $('.post__content video, .post__attachment video').each((index, element) => {
    const videoSrc = $(element).attr('src') || $(element).find('source').attr('src');
    if (videoSrc) {
      addMediaFile(videoSrc, 'video');
    }
  });

  // Priority 5: Find file attachments (including archives)
  $('.post__attachment a').each((index, element) => {
    const attachmentUrl = $(element).attr('href');
    if (attachmentUrl && isDownloadableUrl(attachmentUrl)) {
      const isVideo = isVideoUrl(attachmentUrl);
      const isArchive = isArchiveUrl(attachmentUrl);
      let mediaType = 'image';

      if (isVideo) {
        mediaType = 'video';
      } else if (isArchive) {
        mediaType = 'archive';
      }

      addMediaFile(attachmentUrl, mediaType);
    }
  });

  return mediaFiles;
}

module.exports = {
  extractImagesFromPostData: extractMediaFromPostData,
  extractImagesFromHTML: extractMediaFromHTML,
  extractMediaFromPostData,
  extractMediaFromHTML
};