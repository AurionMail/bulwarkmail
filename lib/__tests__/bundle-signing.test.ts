import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

import {
  verifySignature,
  getPluginSigningKey,
  invalidatePluginSigningKeyCache,
} from '../plugin-sandbox/bundle-signing';

// Mirror lib/admin/plugin-signing.ts: raw 32-byte public key = last 32 bytes
// of the SPKI DER; signature = base64 of the 64-byte Ed25519 signature over
// the UTF-8 bundle bytes.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
const publicKeyB64 = spki.subarray(spki.length - 32).toString('base64');
const CODE = 'export default { activate() {} }';
const signature = nodeSign(null, Buffer.from(CODE, 'utf-8'), privateKey).toString('base64');

const realCrypto = globalThis.crypto;

function pubkeyResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
  invalidatePluginSigningKeyCache();
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue(pubkeyResponse({ algorithm: 'ed25519', publicKey: publicKeyB64 }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifySignature via WebCrypto', () => {
  it('accepts a signature made by the host key', async () => {
    expect(typeof crypto.subtle?.verify).toBe('function');
    await expect(verifySignature(CODE, signature)).resolves.toBe(true);
  });

  it('rejects tampered code', async () => {
    await expect(verifySignature(CODE + ' ', signature)).resolves.toBe(false);
  });

  it('rejects a malformed or missing signature', async () => {
    await expect(verifySignature(CODE, '')).resolves.toBe(false);
    await expect(verifySignature(CODE, 'AAAA')).resolves.toBe(false);
    await expect(verifySignature(CODE, '!!not-base64!!')).resolves.toBe(false);
  });

  it('rejects when the public key cannot be fetched', async () => {
    mocks.apiFetch.mockResolvedValue(pubkeyResponse({ error: 'Signing key unavailable' }, false));
    await expect(verifySignature(CODE, signature)).resolves.toBe(false);
  });

  it('rejects a public key of the wrong algorithm or size', async () => {
    mocks.apiFetch.mockResolvedValue(pubkeyResponse({ algorithm: 'rsa', publicKey: publicKeyB64 }));
    await expect(verifySignature(CODE, signature)).resolves.toBe(false);
    invalidatePluginSigningKeyCache();
    mocks.apiFetch.mockResolvedValue(pubkeyResponse({ algorithm: 'ed25519', publicKey: 'AAAA' }));
    await expect(verifySignature(CODE, signature)).resolves.toBe(false);
  });

  it('fetches the public key once per page', async () => {
    await verifySignature(CODE, signature);
    await verifySignature(CODE, signature);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    const key = await getPluginSigningKey();
    expect(key).toHaveLength(32);
  });
});

describe('verifySignature without WebCrypto (plain-http origin, #636)', () => {
  beforeEach(() => {
    // Insecure contexts expose `crypto.getRandomValues` but no `subtle`.
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
    });
  });

  it('still accepts a good signature', async () => {
    expect(globalThis.crypto.subtle).toBeUndefined();
    await expect(verifySignature(CODE, signature)).resolves.toBe(true);
  });

  it('still rejects a bad signature', async () => {
    await expect(verifySignature(CODE + ' ', signature)).resolves.toBe(false);
    const other = generateKeyPairSync('ed25519').privateKey;
    const forged = nodeSign(null, Buffer.from(CODE, 'utf-8'), other).toString('base64');
    await expect(verifySignature(CODE, forged)).resolves.toBe(false);
  });
});

describe('verifySignature when WebCrypto has no Ed25519 (older browsers)', () => {
  const subtle = {
    importKey: vi.fn(),
    verify: vi.fn(),
  };

  beforeEach(() => {
    subtle.importKey.mockReset().mockRejectedValue(new Error('NotSupportedError: Unrecognized name.'));
    subtle.verify.mockReset();
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
      subtle,
    });
  });

  it('verifies through the JavaScript path instead of failing closed', async () => {
    await expect(verifySignature(CODE, signature)).resolves.toBe(true);
    expect(subtle.importKey).toHaveBeenCalledTimes(1);
    expect(subtle.verify).not.toHaveBeenCalled();
  });

  it('rejects tampered code through the JavaScript path', async () => {
    await expect(verifySignature(CODE + ' ', signature)).resolves.toBe(false);
  });

  it('treats a WebCrypto verify() failure as "no verdict" rather than a mismatch', async () => {
    subtle.importKey.mockReset().mockResolvedValue({} as CryptoKey);
    subtle.verify.mockRejectedValue(new Error('OperationError'));
    await expect(verifySignature(CODE, signature)).resolves.toBe(true);
    await expect(verifySignature(CODE + ' ', signature)).resolves.toBe(false);
  });
});
