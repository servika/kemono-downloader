const fs = require('fs-extra');
const path = require('path');

/**
 * @fileoverview Tracks preview files saved in place of unavailable full images.
 *
 * A preview must not pass for a finished download, so each one is listed in the
 * post's manifest with the pending-full-image status. Later runs try the full
 * image again, and a profile stays in-progress while any manifest has entries.
 */

const PENDING_FULL_IMAGE_STATUS = 'pending-full-image';
const MANIFEST_NAME = '.pending-full.json';

/** @type {Map<string, Promise<void>>} Serializes concurrent manifest updates per post */
const writeQueues = new Map();

function getManifestPath(postDir) {
  return path.join(postDir, MANIFEST_NAME);
}

async function loadPendingFiles(postDir) {
  try {
    const manifest = await fs.readJson(getManifestPath(postDir));
    return manifest?.files || {};
  } catch {
    return {};
  }
}

async function writePendingFiles(postDir, files) {
  const manifestPath = getManifestPath(postDir);
  if (Object.keys(files).length === 0) {
    await fs.remove(manifestPath);
    return;
  }

  const tempPath = `${manifestPath}.tmp`;
  await fs.writeJson(tempPath, { status: PENDING_FULL_IMAGE_STATUS, files }, { spaces: 2 });
  await fs.move(tempPath, manifestPath, { overwrite: true });
}

function updatePendingFiles(postDir, update) {
  const previous = writeQueues.get(postDir) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const files = await loadPendingFiles(postDir);
    update(files);
    await writePendingFiles(postDir, files);
  });
  writeQueues.set(postDir, next);

  const cleanup = () => {
    if (writeQueues.get(postDir) === next) writeQueues.delete(postDir);
  };
  next.then(cleanup, cleanup);
  return next;
}

/**
 * @param {string} postDir
 * @param {string} fileName - Name of the preview file in the post folder
 * @param {{url: string, previewUrl: string}} source
 * @returns {Promise<void>}
 */
function markPendingFullImage(postDir, fileName, { url, previewUrl }) {
  return updatePendingFiles(postDir, (files) => {
    files[fileName] = { url, previewUrl, savedAt: new Date().toISOString() };
  });
}

function clearPendingFullImage(postDir, fileName) {
  return updatePendingFiles(postDir, (files) => {
    delete files[fileName];
  });
}

/**
 * Counts previews on disk rather than in run stats, so a post whose page failed
 * to load this run still keeps its profile from being marked completed.
 * @param {string} profileDir
 * @returns {Promise<number>}
 */
async function countPendingInProfile(profileDir) {
  let entries;
  try {
    entries = await fs.readdir(profileDir);
  } catch {
    return 0;
  }
  if (!Array.isArray(entries)) return 0;

  let total = 0;
  for (const entry of entries) {
    total += Object.keys(await loadPendingFiles(path.join(profileDir, entry))).length;
  }
  return total;
}

module.exports = {
  PENDING_FULL_IMAGE_STATUS,
  loadPendingFiles,
  markPendingFullImage,
  clearPendingFullImage,
  countPendingInProfile
};
