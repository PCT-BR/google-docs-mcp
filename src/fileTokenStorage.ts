import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { TokenStorage } from 'fastmcp/auth';

const DEFAULT_DIR = path.join(os.homedir(), '.config', 'google-docs-mcp', 'oauth-tokens');

interface StoredTokenRecord {
  key: string;
  value: unknown;
  ttl?: number;
  createdAt: number;
}

/**
 * File-backed TokenStorage for FastMCP's OAuth proxy.
 * Intended for single-instance personal deployments with a persistent volume.
 */
export class FileTokenStorage implements TokenStorage {
  private dir: string;

  constructor(dir = process.env.TOKEN_STORE_DIR || DEFAULT_DIR) {
    this.dir = dir;
  }

  async save(key: string, value: unknown, ttl?: number): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const filePath = this.filePathForKey(key);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const record: StoredTokenRecord = {
      key,
      value,
      ttl,
      createdAt: Date.now(),
    };

    await fs.writeFile(tempPath, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(tempPath, filePath);
  }

  async get(key: string): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(this.filePathForKey(key), 'utf8');
      const record = JSON.parse(raw) as StoredTokenRecord;
      if (record.key !== key) return null;
      return record.value;
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.filePathForKey(key));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async cleanup(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const files = await fs.readdir(this.dir);
    await Promise.all(
      files
        .filter((file) => file.endsWith('.tmp'))
        .map((file) => fs.unlink(path.join(this.dir, file)).catch(() => undefined))
    );
  }

  private filePathForKey(key: string) {
    return path.join(this.dir, `${hashKey(key)}.json`);
  }
}

function hashKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
