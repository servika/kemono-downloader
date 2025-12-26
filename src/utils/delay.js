/**
 * Utility function for adding delays
 */
async function delay(ms) {
  if (typeof ms !== 'number' || ms < 0) {
    throw new Error('Delay must be a non-negative number');
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { delay };