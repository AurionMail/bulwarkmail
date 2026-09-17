import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { fileStorage } from '../plugin-storage';

const DB_NAME = 'bulwark-plugins';
// One below the version plugin-storage.ts opens, simulating an older tab.
const PREVIOUS_DB_VERSION = 2;

function openAt(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe('plugin storage when the upgrade is blocked (#840)', () => {
  it('rejects saveFile instead of hanging while an older tab keeps the DB open', async () => {
    // An "older tab" that never reacts to versionchange, so the upgrade to the
    // current DB_VERSION cannot proceed.
    const olderTab = await openAt(PREVIOUS_DB_VERSION);
    expect(olderTab.version).toBe(PREVIOUS_DB_VERSION);

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const outcome = await Promise.race([
      fileStorage.saveFile('blocked-file', file).then(
        () => 'resolved',
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
    ]);

    expect(outcome).not.toBe('timeout');
    expect(outcome).not.toBe('resolved');
    expect(outcome).toMatch(/blocked/i);

    olderTab.close();
  });

  it('closes its own connection so a later upgrade is not blocked by it', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await fileStorage.saveFile('closed-file', file);
    expect(await fileStorage.getFile('closed-file')).not.toBeNull();

    // If plugin-storage left its connection open, opening at a higher version
    // would fire `blocked` (no onversionchange handler on a foreign handle);
    // with the fix the module closes after every transaction.
    const blocked = await new Promise<boolean>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 99);
      req.onblocked = () => resolve(true);
      req.onsuccess = () => {
        req.result.close();
        resolve(false);
      };
      req.onerror = () => reject(req.error);
    });
    expect(blocked).toBe(false);
  });
});
