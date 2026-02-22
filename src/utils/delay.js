/**
 * @fileoverview Simple delay utility for async operations
 * Provides a promise-based delay function for rate limiting and retry logic
 */

/**
 * Creates a promise that resolves after the specified delay
 * Used for rate limiting, retry backoff, and throttling operations
 *
 * @async
 * @param {number} ms - Delay duration in milliseconds (must be non-negative)
 * @returns {Promise<void>} Promise that resolves after the delay
 * @throws {Error} If ms is not a non-negative number
 *
 * @example
 * await delay(1000); // Wait 1 second
 * await delay(5000); // Wait 5 seconds
 */
async function delay(ms) {
  if (typeof ms !== 'number' || ms < 0) {
    throw new Error('Delay must be a non-negative number');
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { delay };