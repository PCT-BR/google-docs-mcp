import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FileTokenStorage } from './fileTokenStorage.js';

describe('FileTokenStorage', () => {
  it('persists, reads, and deletes token values by hashed key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'google-docs-mcp-tokens-'));
    try {
      const storage = new FileTokenStorage(dir);
      const key = 'client/opaque-token-key';
      const value = { accessToken: 'access', refreshToken: 'refresh' };

      await storage.save(key, value, 60);
      expect(await storage.get(key)).toEqual(value);

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);

      await storage.delete(key);
      expect(await storage.get(key)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
