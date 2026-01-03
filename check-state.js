#!/usr/bin/env node
const DownloadState = require('./src/utils/downloadState');

const state = new DownloadState();
const stats = state.getStatistics();

console.log('📊 Download State Status:');
console.log('='.repeat(50));
console.log(`Total profiles tracked: ${stats.total}`);
console.log(`Completed profiles: ${stats.completed}`);
console.log(`In progress: ${stats.inProgress}`);
console.log(`Total posts: ${stats.totalPosts}`);
console.log(`Downloaded posts: ${stats.downloadedPosts}`);
console.log('='.repeat(50));

if (stats.completed > 0) {
  console.log('\n✅ State file is working! Completed profiles:');
  const completed = state.getCompletedProfiles();
  completed.slice(0, 10).forEach(profile => {
    console.log(`   • ${profile}`);
  });
  if (completed.length > 10) {
    console.log(`   ... and ${completed.length - 10} more`);
  }
} else if (stats.total > 0) {
  console.log('\n⚠️  Profiles tracked but none completed yet');
} else {
  console.log('\n⚠️  No state data found - run downloads or rebuild-state first');
}
