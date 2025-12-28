#!/usr/bin/env node

/**
 * Update all existing HTML files with localized image paths
 * Replaces remote URLs with local file paths for offline viewing
 */

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const { getImageName } = require('./src/utils/urlUtils');

/**
 * Helper function to find local file matching a remote URL
 */
function findLocalFile(url, fileMap, localFiles) {
  if (!url) return null;

  // Direct match in fileMap
  if (fileMap.has(url)) {
    return fileMap.get(url);
  }

  // Try to extract filename from URL
  try {
    const urlObj = new URL(url, 'https://kemono.cr'); // Base URL for relative paths
    const urlPath = urlObj.pathname;
    const filename = path.basename(urlPath);

    // Check if this filename exists locally
    if (localFiles.includes(filename)) {
      return filename;
    }

    // Try to match by partial filename (useful for sanitized names)
    const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');
    for (const localFile of localFiles) {
      const localWithoutExt = localFile.replace(/\.[^.]+$/, '');
      if (localFile.includes(filenameWithoutExt) || filenameWithoutExt.includes(localWithoutExt)) {
        return localFile;
      }
    }
  } catch (error) {
    // Invalid URL, skip
  }

  return null;
}

/**
 * Update a single HTML file with localized paths
 */
async function updateHtmlFile(htmlPath, postDir) {
  try {
    // Read the HTML file
    const html = await fs.readFile(htmlPath, 'utf8');

    // Check if already localized
    if (html.includes('kemono-downloader-note')) {
      console.log(`  ⏭️  Already localized: ${htmlPath}`);
      return { updated: false, reason: 'already-localized' };
    }

    // Parse HTML with cheerio
    const $ = cheerio.load(html);

    // Get list of local files
    const localFiles = await fs.readdir(postDir).catch(() => []);
    const mediaFiles = localFiles.filter(f =>
      f !== 'post.html' &&
      f !== 'post-metadata.json' &&
      /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|zip|rar|7z)$/i.test(f)
    );

    if (mediaFiles.length === 0) {
      console.log(`  ⏭️  No media files: ${htmlPath}`);
      return { updated: false, reason: 'no-media' };
    }

    const fileMap = new Map();
    let replacements = 0;

    // Process <img> tags
    $('img').each((i, elem) => {
      const $img = $(elem);
      const src = $img.attr('src');
      const dataSrc = $img.attr('data-src');

      // Try to find local file for src
      if (src && !src.startsWith('data:') && (src.startsWith('http') || src.startsWith('//'))) {
        const localFile = findLocalFile(src, fileMap, mediaFiles);
        if (localFile) {
          $img.attr('data-original-src', src);
          $img.attr('src', localFile);
          replacements++;
        }
      }

      // Try to find local file for data-src
      if (dataSrc && !dataSrc.startsWith('data:') && (dataSrc.startsWith('http') || dataSrc.startsWith('//'))) {
        const localFile = findLocalFile(dataSrc, fileMap, mediaFiles);
        if (localFile) {
          $img.attr('data-original-data-src', dataSrc);
          $img.attr('data-src', localFile);
          replacements++;
        }
      }
    });

    // Process <video> tags
    $('video').each((i, elem) => {
      const $video = $(elem);
      const src = $video.attr('src');

      if (src && (src.startsWith('http') || src.startsWith('//'))) {
        const localFile = findLocalFile(src, fileMap, mediaFiles);
        if (localFile) {
          $video.attr('data-original-src', src);
          $video.attr('src', localFile);
          replacements++;
        }
      }
    });

    // Process <source> tags
    $('source').each((i, elem) => {
      const $source = $(elem);
      const src = $source.attr('src');

      if (src && (src.startsWith('http') || src.startsWith('//'))) {
        const localFile = findLocalFile(src, fileMap, mediaFiles);
        if (localFile) {
          $source.attr('data-original-src', src);
          $source.attr('src', localFile);
          replacements++;
        }
      }
    });

    // Process download links
    $('a[download], a[href*="/data/"], a.fileThumb, a.post__attachment-link').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');

      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && (href.startsWith('http') || href.startsWith('//'))) {
        const localFile = findLocalFile(href, fileMap, mediaFiles);
        if (localFile) {
          $link.attr('data-original-href', href);
          $link.attr('href', localFile);
          replacements++;
        }
      }
    });

    if (replacements === 0) {
      console.log(`  ⏭️  No replacements: ${htmlPath}`);
      return { updated: false, reason: 'no-replacements' };
    }

    // Add meta tag to indicate this is localized
    $('head').prepend(`
      <meta name="kemono-downloader" content="localized">
      <meta name="kemono-downloader-note" content="Image URLs have been replaced with local paths. Original URLs preserved in data-original-* attributes.">
      <style>
        /* Add visual indicator for localized content */
        body::before {
          content: "📁 Offline Version - Images loaded locally";
          display: block;
          background: #f0f0f0;
          padding: 10px;
          text-align: center;
          font-family: system-ui, sans-serif;
          border-bottom: 2px solid #ddd;
          position: sticky;
          top: 0;
          z-index: 1000;
        }
      </style>
    `);

    // Save the updated HTML
    await fs.writeFile(htmlPath, $.html());

    console.log(`  ✅ Updated: ${htmlPath} (${replacements} replacements)`);
    return { updated: true, replacements };

  } catch (error) {
    console.error(`  ❌ Error updating ${htmlPath}: ${error.message}`);
    return { updated: false, reason: 'error', error: error.message };
  }
}

/**
 * Find all HTML files recursively
 */
async function findHtmlFiles(baseDir) {
  const htmlFiles = [];

  async function scan(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name === 'post.html') {
        htmlFiles.push(fullPath);
      }
    }
  }

  await scan(baseDir);
  return htmlFiles;
}

/**
 * Main function
 */
async function main() {
  const config = require('./src/utils/config');
  await config.load();

  const baseDir = config.getBaseDirectory();

  console.log('🔍 Scanning for HTML files...');
  console.log(`📁 Base directory: ${baseDir}\n`);

  if (!await fs.pathExists(baseDir)) {
    console.error(`❌ Directory not found: ${baseDir}`);
    process.exit(1);
  }

  const htmlFiles = await findHtmlFiles(baseDir);

  if (htmlFiles.length === 0) {
    console.log('ℹ️  No HTML files found');
    return;
  }

  console.log(`📋 Found ${htmlFiles.length} HTML files\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < htmlFiles.length; i++) {
    const htmlPath = htmlFiles[i];
    const postDir = path.dirname(htmlPath);
    const relativePath = path.relative(baseDir, htmlPath);

    console.log(`[${i + 1}/${htmlFiles.length}] ${relativePath}`);

    const result = await updateHtmlFile(htmlPath, postDir);

    if (result.updated) {
      updated++;
    } else if (result.reason === 'error') {
      errors++;
    } else {
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 UPDATE SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Updated: ${updated} files`);
  console.log(`⏭️  Skipped: ${skipped} files`);
  console.log(`❌ Errors: ${errors} files`);
  console.log('='.repeat(50));

  if (updated > 0) {
    console.log('\n🎉 HTML files have been updated with local image paths!');
    console.log('📁 You can now view them offline with all images loading locally.');
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});