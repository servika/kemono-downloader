const fs = require('fs-extra');
const KemonoDownloader = require('./src/KemonoDownloader');

// Main execution
async function main() {
  console.log('🚀 Starting Kemono Downloader...\n');
  const downloader = new KemonoDownloader();

  // Initialize configuration
  await downloader.initialize();

  // Get input file from command line arguments or use default
  const inputFile = process.argv[2] || 'profiles.txt';

  if (!inputFile) {
    console.log('Usage: node index.js [profiles.txt]');
    console.log('');
    console.log('Defaults to profiles.txt if no file specified.');
    console.log('Create a text file with one profile URL per line:');
    console.log('https://kemono.cr/patreon/user/42015243');
    console.log('https://kemono.cr/patreon/user/12345678');
    process.exit(1);
  }

  if (!(await fs.pathExists(inputFile))) {
    console.error(`❌ Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const startTime = Date.now();
  await downloader.processProfilesFile(inputFile);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n⏱️  Total runtime: ${duration} seconds`);
}

main().catch((error) => {
  console.error('\n💥 Fatal error:', error.message);
  process.exit(1);
});
