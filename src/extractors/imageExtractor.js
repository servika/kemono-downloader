const { isImageUrl, isVideoUrl, isMediaUrl } = require('../utils/urlUtils');

/**
 * Media extraction utilities for images and videos
 */

function extractMediaFromPostData(postData) {
  const mediaFiles = [];
  
  try {
    // Handle the specific Kemono API response structure
    
    // 1. Extract from post.file (main file)
    if (postData.post?.file?.path) {
      const mainFileUrl = `https://kemono.su${postData.post.file.path}`;
      const isVideo = isVideoUrl(mainFileUrl);
      mediaFiles.push({
        url: mainFileUrl,
        filename: postData.post.file.name || null,
        type: 'main',
        mediaType: isVideo ? 'video' : 'image'
      });
      console.log(`    ${isVideo ? '🎥' : '🖼️'}  Found main file: ${postData.post.file.name}`);
    }
    
    // 2. Extract from post.attachments (additional files)
    if (postData.post?.attachments && Array.isArray(postData.post.attachments)) {
      for (const attachment of postData.post.attachments) {
        if (attachment.path && isMediaUrl(attachment.path)) {
          const attachmentUrl = `https://kemono.su${attachment.path}`;
          const isVideo = isVideoUrl(attachmentUrl);
          mediaFiles.push({
            url: attachmentUrl,
            filename: attachment.name || null,
            type: 'attachment',
            mediaType: isVideo ? 'video' : 'image'
          });
          console.log(`    ${isVideo ? '🎥' : '🖼️'}  Found attachment: ${attachment.name}`);
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
          if (!isDuplicate && isMediaUrl(previewUrl)) {
            const isVideo = isVideoUrl(previewUrl);
            mediaFiles.push({
              url: previewUrl,
              filename: preview.name || null,
              type: 'preview',
              mediaType: isVideo ? 'video' : 'image'
            });
            console.log(`    ${isVideo ? '🎥' : '🖼️'}  Found preview: ${preview.name} (${preview.type})`);
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
        // Check if it's an image URL or contains image URLs
        if (isMediaUrl(source)) {
          const fullUrl = source.startsWith('http') ? source : `https://kemono.su${source}`;
          const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
          if (!alreadyExists) {
            const isVideo = isVideoUrl(fullUrl);
            mediaFiles.push({
              url: fullUrl,
              filename: null,
              type: 'legacy',
              mediaType: isVideo ? 'video' : 'image'
            });
          }
        } else {
          // Extract image URLs from content text
          const mediaMatches = source.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|avi|mov|wmv|flv|mkv|m4v|3gp|ogv)/gi);
          if (mediaMatches) {
            for (const match of mediaMatches) {
              const alreadyExists = mediaFiles.some(media => media.url === match);
              if (!alreadyExists) {
                const isVideo = isVideoUrl(match);
                mediaFiles.push({
                  url: match,
                  filename: null,
                  type: 'content',
                  mediaType: isVideo ? 'video' : 'image'
                });
              }
            }
          }
        }
      } else if (Array.isArray(source)) {
        // Handle arrays of attachments/images
        for (const item of source) {
          if (typeof item === 'string' && isMediaUrl(item)) {
            const fullUrl = item.startsWith('http') ? item : `https://kemono.su${item}`;
            const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
            if (!alreadyExists) {
              const isVideo = isVideoUrl(fullUrl);
              mediaFiles.push({
                url: fullUrl,
                filename: null,
                type: 'legacy',
                mediaType: isVideo ? 'video' : 'image'
              });
            }
          } else if (item && typeof item === 'object') {
            // Handle attachment objects
            const attachmentUrl = item.path || item.url || item.src;
            if (attachmentUrl && isMediaUrl(attachmentUrl)) {
              const fullUrl = attachmentUrl.startsWith('http') ? attachmentUrl : `https://kemono.su${attachmentUrl}`;
              const alreadyExists = mediaFiles.some(media => media.url === fullUrl);
              if (!alreadyExists) {
                const isVideo = isVideoUrl(fullUrl);
                mediaFiles.push({
                  url: fullUrl,
                  filename: item.name || null,
                  type: 'legacy',
                  mediaType: isVideo ? 'video' : 'image'
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
  
  // Find images in post content
  $('.post__content img, .post__thumbnail img, .post__attachment img').each((index, element) => {
    const imgSrc = $(element).attr('src') || $(element).attr('data-src');
    if (imgSrc) {
      const imageUrl = imgSrc.startsWith('http') ? imgSrc : `https://kemono.su${imgSrc}`;
      mediaFiles.push({ url: imageUrl, mediaType: 'image', type: 'html' });
    }
  });

  // Find videos in post content
  $('.post__content video, .post__attachment video').each((index, element) => {
    const videoSrc = $(element).attr('src') || $(element).find('source').attr('src');
    if (videoSrc) {
      const videoUrl = videoSrc.startsWith('http') ? videoSrc : `https://kemono.su${videoSrc}`;
      mediaFiles.push({ url: videoUrl, mediaType: 'video', type: 'html' });
    }
  });

  // Find file attachments
  $('.post__attachment a').each((index, element) => {
    const attachmentUrl = $(element).attr('href');
    if (attachmentUrl && isMediaUrl(attachmentUrl)) {
      const fullUrl = attachmentUrl.startsWith('http') ? attachmentUrl : `https://kemono.su${attachmentUrl}`;
      const isVideo = isVideoUrl(fullUrl);
      mediaFiles.push({ url: fullUrl, mediaType: isVideo ? 'video' : 'image', type: 'html' });
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