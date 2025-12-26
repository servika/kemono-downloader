const { delay } = require('../../src/utils/delay');

describe('delay utility', () => {
  beforeEach(() => {
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should delay for specified milliseconds', async () => {
    const delayPromise = delay(1000);
    
    // Promise should not resolve immediately
    let resolved = false;
    delayPromise.then(() => { resolved = true; });
    
    expect(resolved).toBe(false);
    
    // Fast-forward time
    jest.advanceTimersByTime(1000);
    await delayPromise;
    
    expect(resolved).toBe(true);
  });

  test('should delay for zero milliseconds', async () => {
    const delayPromise = delay(0);
    jest.advanceTimersByTime(0);
    await expect(delayPromise).resolves.toBeUndefined();
  });

  test('should throw error for negative delay', async () => {
    await expect(delay(-100)).rejects.toThrow('Delay must be a non-negative number');
  });

  test('should throw error for non-number delay', async () => {
    await expect(delay('invalid')).rejects.toThrow('Delay must be a non-negative number');
    await expect(delay(null)).rejects.toThrow('Delay must be a non-negative number');
    await expect(delay(undefined)).rejects.toThrow('Delay must be a non-negative number');
  });

  test('should handle large delay values', async () => {
    const delayPromise = delay(60000); // 1 minute
    
    let resolved = false;
    delayPromise.then(() => { resolved = true; });
    
    jest.advanceTimersByTime(59999);
    expect(resolved).toBe(false);
    
    jest.advanceTimersByTime(1);
    await delayPromise;
    expect(resolved).toBe(true);
  });
});