const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const ProfileFileManager = require('../../src/utils/profileFileManager');
const fs = require('fs-extra');
const path = require('path');

// Mock fs-extra
jest.mock('fs-extra');

describe('ProfileFileManager', () => {
  let profileManager;
  const testFilePath = '/tmp/test-profiles.txt';

  beforeEach(() => {
    jest.clearAllMocks();
    profileManager = new ProfileFileManager(testFilePath);
  });

  describe('readProfiles', () => {
    test('should read active profiles and skip commented lines', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)
https://kemono.cr/fanbox/user/789

# This is a comment
`;

      fs.readFile.mockResolvedValue(fileContent);

      const profiles = await profileManager.readProfiles();

      expect(profiles).toEqual([
        'https://kemono.cr/patreon/user/123',
        'https://kemono.cr/fanbox/user/789'
      ]);
    });

    test('should skip empty lines', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123


https://kemono.cr/fanbox/user/789
`;

      fs.readFile.mockResolvedValue(fileContent);

      const profiles = await profileManager.readProfiles();

      expect(profiles).toEqual([
        'https://kemono.cr/patreon/user/123',
        'https://kemono.cr/fanbox/user/789'
      ]);
    });

    test('should skip lines without kemono URLs', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
https://example.com/user/456
Random text
https://kemono.cr/fanbox/user/789
`;

      fs.readFile.mockResolvedValue(fileContent);

      const profiles = await profileManager.readProfiles();

      expect(profiles).toEqual([
        'https://kemono.cr/patreon/user/123',
        'https://kemono.cr/fanbox/user/789'
      ]);
    });

    test('should return empty array for empty file', async () => {
      fs.readFile.mockResolvedValue('');

      const profiles = await profileManager.readProfiles();

      expect(profiles).toEqual([]);
    });

    test('should throw error if file read fails', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(profileManager.readProfiles()).rejects.toThrow('Failed to read profiles file');
    });
  });

  describe('readAllLines', () => {
    test('should read all lines including comments', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);

      const lines = await profileManager.readAllLines();

      expect(lines).toEqual([
        'https://kemono.cr/patreon/user/123',
        '# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)',
        'https://kemono.cr/fanbox/user/789'
      ]);
    });
  });

  describe('commentProfile', () => {
    test('should comment out a profile with metadata', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
https://kemono.cr/fanbox/user/456
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile('https://kemono.cr/fanbox/user/456', {
        postCount: 50,
        timestamp: '2026-01-03 10:00:00'
      });

      // Check that writeFile was called with commented content
      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();

      const writtenContent = tempFileWrite[1];
      expect(writtenContent).toContain('# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)');
      expect(writtenContent).toContain('https://kemono.cr/patreon/user/123');
      expect(writtenContent).toContain('https://kemono.cr/fanbox/user/789');
    });

    test('should not comment already commented profiles', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const fileContent = `https://kemono.cr/patreon/user/123
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile('https://kemono.cr/fanbox/user/456', {
        postCount: 50,
        timestamp: '2026-01-03 10:00:00'
      });

      // Should warn that URL is not found (because it's already commented)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Profile URL not found'));
      consoleSpy.mockRestore();
    });

    test('should use current timestamp if not provided', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile('https://kemono.cr/patreon/user/123', {
        postCount: 25
      });

      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();

      const writtenContent = tempFileWrite[1];
      expect(writtenContent).toMatch(/# https:\/\/kemono\.cr\/patreon\/user\/123 # Completed: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(25 posts\)/);
    });

    test('should warn if profile URL not found', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const fileContent = `https://kemono.cr/patreon/user/123`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile('https://kemono.cr/nonexistent/user/999', {
        postCount: 0
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Profile URL not found'));
      consoleSpy.mockRestore();
    });
  });

  describe('uncommentProfile', () => {
    test('should uncomment a commented profile', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.uncommentProfile('https://kemono.cr/fanbox/user/456');

      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();

      const writtenContent = tempFileWrite[1];
      expect(writtenContent).toContain('https://kemono.cr/fanbox/user/456');
      expect(writtenContent).not.toContain('# https://kemono.cr/fanbox/user/456 # Completed');
    });

    test('should not affect already active profiles', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
https://kemono.cr/fanbox/user/456`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.uncommentProfile('https://kemono.cr/fanbox/user/456');

      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();

      const writtenContent = tempFileWrite[1];
      expect(writtenContent).toContain('https://kemono.cr/fanbox/user/456');
    });
  });

  describe('writeAtomic', () => {
    test('should write to temp file then rename', async () => {
      const content = 'test content';
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.writeAtomic(content);

      // Should write to temp file
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${testFilePath}.tmp`,
        content,
        'utf-8'
      );

      // Should create backup
      expect(fs.copyFile).toHaveBeenCalledWith(
        testFilePath,
        `${testFilePath}.backup`
      );

      // Should rename temp to original
      expect(fs.rename).toHaveBeenCalledWith(
        `${testFilePath}.tmp`,
        testFilePath
      );

      // Should remove backup after success
      expect(fs.remove).toHaveBeenCalledWith(`${testFilePath}.backup`);
    });

    test('should restore from backup on write failure', async () => {
      const content = 'test content';
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockRejectedValue(new Error('Rename failed'));
      fs.remove.mockResolvedValue();

      await expect(profileManager.writeAtomic(content)).rejects.toThrow('Atomic write failed');

      // Should restore from backup
      expect(fs.copyFile).toHaveBeenCalledWith(
        `${testFilePath}.backup`,
        testFilePath
      );

      // Should clean up backup and temp
      expect(fs.remove).toHaveBeenCalledWith(`${testFilePath}.backup`);
      expect(fs.remove).toHaveBeenCalledWith(`${testFilePath}.tmp`);
    });
  });

  describe('queueWrite', () => {
    test('should process operations sequentially', async () => {
      const fileContent = 'https://kemono.cr/patreon/user/123\nhttps://kemono.cr/fanbox/user/456';
      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      const executionOrder = [];

      // Queue multiple operations
      const promise1 = profileManager.queueWrite(async () => {
        executionOrder.push(1);
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const promise2 = profileManager.queueWrite(async () => {
        executionOrder.push(2);
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const promise3 = profileManager.queueWrite(async () => {
        executionOrder.push(3);
      });

      await Promise.all([promise1, promise2, promise3]);

      // Should execute in order
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    test('should handle errors in queued operations', async () => {
      const error = new Error('Operation failed');

      const promise = profileManager.queueWrite(async () => {
        throw error;
      });

      await expect(promise).rejects.toThrow('Operation failed');
    });

    test('should continue processing queue after error', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      const executionOrder = [];

      const promise1 = profileManager.queueWrite(async () => {
        executionOrder.push(1);
      });

      const promise2 = profileManager.queueWrite(async () => {
        executionOrder.push(2);
        throw new Error('Failed');
      });

      const promise3 = profileManager.queueWrite(async () => {
        executionOrder.push(3);
      });

      await promise1;
      await promise2.catch(() => {}); // Ignore error
      await promise3;

      // All operations should execute despite error in #2
      expect(executionOrder).toEqual([1, 2, 3]);
    });
  });

  describe('getStatistics', () => {
    test('should return correct statistics', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)
https://kemono.cr/fanbox/user/789
# https://kemono.cr/patreon/user/999 # Completed: 2026-01-03 11:00:00 (25 posts)`;

      fs.readFile.mockResolvedValue(fileContent);

      const stats = await profileManager.getStatistics();

      expect(stats).toEqual({
        total: 4,
        active: 2,
        completed: 2
      });
    });

    test('should return zero stats for empty file', async () => {
      fs.readFile.mockResolvedValue('');

      const stats = await profileManager.getStatistics();

      expect(stats).toEqual({
        total: 0,
        active: 0,
        completed: 0
      });
    });

    test('should not count regular comments as completed', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
# This is a regular comment
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);

      const stats = await profileManager.getStatistics();

      expect(stats).toEqual({
        total: 2,
        active: 2,
        completed: 0
      });
    });
  });

  describe('concurrent writes', () => {
    test('should handle multiple concurrent comment operations safely', async () => {
      const fileContent = `https://kemono.cr/patreon/user/123
https://kemono.cr/fanbox/user/456
https://kemono.cr/fanbox/user/789`;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      // Simulate concurrent profile completions
      const promises = [
        profileManager.commentProfile('https://kemono.cr/patreon/user/123', { postCount: 10 }),
        profileManager.commentProfile('https://kemono.cr/fanbox/user/456', { postCount: 20 }),
        profileManager.commentProfile('https://kemono.cr/fanbox/user/789', { postCount: 30 })
      ];

      await Promise.all(promises);

      // All operations should complete without errors
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    test('should handle profiles with special characters in URL', async () => {
      const fileContent = 'https://kemono.cr/patreon/user/123?param=value&other=test';

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile('https://kemono.cr/patreon/user/123?param=value&other=test', {
        postCount: 5
      });

      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();

      const writtenContent = tempFileWrite[1];
      expect(writtenContent).toContain('# https://kemono.cr/patreon/user/123?param=value&other=test # Completed');
    });

    test('should handle very long profile URLs', async () => {
      const longUrl = 'https://kemono.cr/patreon/user/' + '1'.repeat(1000);
      const fileContent = longUrl;

      fs.readFile.mockResolvedValue(fileContent);
      fs.pathExists.mockResolvedValue(true);
      fs.writeFile.mockResolvedValue();
      fs.copyFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      fs.remove.mockResolvedValue();

      await profileManager.commentProfile(longUrl, { postCount: 1 });

      const writeCalls = fs.writeFile.mock.calls;
      const tempFileWrite = writeCalls.find(call => call[0].includes('.tmp'));
      expect(tempFileWrite).toBeDefined();
    });

    test('should handle file with only comments', async () => {
      const fileContent = `# Comment 1
# Comment 2
# https://kemono.cr/fanbox/user/456 # Completed: 2026-01-03 10:00:00 (50 posts)`;

      fs.readFile.mockResolvedValue(fileContent);

      const profiles = await profileManager.readProfiles();

      expect(profiles).toEqual([]);
    });
  });
});