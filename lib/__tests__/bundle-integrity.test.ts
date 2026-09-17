import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex, verifyBundle, constantTimeHexEqual } from '../plugin-sandbox/bundle-integrity';

const CODE = 'export default { activate() {} } // ' + 'x'.repeat(5000);
const nodeHash = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const realCrypto = globalThis.crypto;

/**
 * What a plain-http origin exposes: `crypto.getRandomValues` is there, but
 * `crypto.subtle` is not (WebCrypto is limited to secure contexts).
 */
function stubInsecureContext(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256Hex', () => {
  it('matches a reference digest via WebCrypto', async () => {
    expect(typeof crypto.subtle?.digest).toBe('function');
    expect(await sha256Hex(CODE)).toBe(nodeHash(CODE));
  });

  it('hashes byte input the same as string input', async () => {
    expect(await sha256Hex(new TextEncoder().encode(CODE))).toBe(nodeHash(CODE));
  });

  it('handles multi-byte UTF-8', async () => {
    const s = 'héllo → 世界 🚀';
    expect(await sha256Hex(s)).toBe(nodeHash(s));
  });

  it('falls back to a JavaScript digest when crypto.subtle is unavailable (plain-http origin)', async () => {
    stubInsecureContext();
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(await sha256Hex(CODE)).toBe(nodeHash(CODE));
    expect(await sha256Hex('')).toBe(nodeHash(''));
    expect(await sha256Hex(new TextEncoder().encode('bytes'))).toBe(nodeHash('bytes'));
  });

  it('falls back when WebCrypto refuses the digest call', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
      subtle: { digest: vi.fn().mockRejectedValue(new Error('NotSupportedError')) },
    });
    expect(await sha256Hex(CODE)).toBe(nodeHash(CODE));
  });
});

describe('verifyBundle', () => {
  it('accepts a quoted / upper-case expected hash (ETag form)', async () => {
    const hash = nodeHash(CODE);
    await expect(verifyBundle(CODE, '"' + hash + '"')).resolves.toBe(hash);
    await expect(verifyBundle(CODE, hash.toUpperCase())).resolves.toBe(hash);
  });

  it('throws on mismatch', async () => {
    await expect(verifyBundle(CODE, nodeHash('something else'))).rejects.toThrow(/integrity mismatch/);
  });

  it('returns the computed hash when no expected hash is given', async () => {
    await expect(verifyBundle(CODE, undefined)).resolves.toBe(nodeHash(CODE));
    await expect(verifyBundle(CODE, null)).resolves.toBe(nodeHash(CODE));
  });

  it('still verifies (and still refuses) without WebCrypto', async () => {
    stubInsecureContext();
    await expect(verifyBundle(CODE, nodeHash(CODE))).resolves.toBe(nodeHash(CODE));
    await expect(verifyBundle(CODE, nodeHash('tampered'))).rejects.toThrow(/integrity mismatch/);
  });
});

describe('constantTimeHexEqual', () => {
  it('compares equal-length lower-case hex', () => {
    expect(constantTimeHexEqual('abcd', 'abcd')).toBe(true);
    expect(constantTimeHexEqual('abcd', 'abce')).toBe(false);
  });

  it('rejects structural mismatches', () => {
    expect(constantTimeHexEqual('abcd', 'abc')).toBe(false);
    expect(constantTimeHexEqual('abcd', undefined as unknown as string)).toBe(false);
  });
});
