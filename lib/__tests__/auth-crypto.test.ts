import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  encryptSession,
  decryptSession,
  encryptPayload,
  decryptPayload,
} from '@/lib/auth/crypto';

// crypto.ts derives its key solely from getSessionSecret(); mock that one seam
// so we control the secret without touching configManager / env-file lookups.
const { secretRef } = vi.hoisted(() => ({ secretRef: { value: 'x'.repeat(32) } }));
vi.mock('@/lib/auth/session-secret', () => ({
  getSessionSecret: () => secretRef.value,
  hasSessionSecret: () => secretRef.value.length > 0,
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

const SECRET = 'x'.repeat(32);

beforeEach(() => {
  secretRef.value = SECRET;
});

describe('encryptSession / decryptSession', () => {
  it('round-trips a session', () => {
    const token = encryptSession('https://mail.example.com', 'alice', 's3cret');
    expect(decryptSession(token)).toEqual({
      serverUrl: 'https://mail.example.com',
      username: 'alice',
      password: 's3cret',
    });
  });

  it('produces a base64 token with a random IV (two encrypts differ, both decrypt equal)', () => {
    const a = encryptSession('https://x', 'u', 'p');
    const b = encryptSession('https://x', 'u', 'p');
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64').toString('base64')).toBe(a); // valid base64
    expect(decryptSession(a)).toEqual(decryptSession(b));
  });

  it('returns null (not throw) on a tampered auth tag', () => {
    const token = encryptSession('https://x', 'u', 'p');
    const buf = Buffer.from(token, 'base64');
    buf[13] ^= 0xff; // flip a byte inside the GCM tag region (bytes 12..28)
    expect(decryptSession(buf.toString('base64'))).toBeNull();
  });

  it('returns null on a token shorter than IV+TAG', () => {
    expect(decryptSession(Buffer.alloc(10).toString('base64'))).toBeNull();
  });

  it('returns null when the version is not 1', () => {
    const token = encryptPayload({ v: 2, serverUrl: 'https://x', username: 'u', password: 'p' }, 'session-context');
    expect(decryptSession(token)).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const token = encryptPayload({ v: 1, serverUrl: 'https://x', username: 'u' }, 'session-context');
    expect(decryptSession(token)).toBeNull();
  });

  it('throws when no secret is configured', () => {
    secretRef.value = '';
    expect(() => encryptSession('https://x', 'u', 'p')).toThrow('SESSION_SECRET not configured');
  });

  it('throws when the secret is shorter than 32 characters', () => {
    secretRef.value = 'tooshort';
    expect(() => encryptSession('https://x', 'u', 'p')).toThrow(/at least 32 characters/);
  });
});

describe('encryptPayload / decryptPayload', () => {
  it('round-trips an arbitrary object and stamps the purpose', () => {
    const token = encryptPayload({ a: 1, b: 'two', c: { nested: true } }, 'sso-pending');
    expect(decryptPayload(token, 'sso-pending')).toEqual({
      a: 1, b: 'two', c: { nested: true }, p: 'sso-pending',
    });
  });

  it('does NOT enforce the version/field guard that decryptSession applies', () => {
    // CHARACTERISATION: decryptPayload returns whatever JSON parsed, with no
    // v===1 / required-field validation (unlike decryptSession). The purpose
    // is the only thing it enforces.
    const token = encryptPayload({ v: 2, anything: 'goes' }, 'sso-pending');
    expect(decryptPayload(token, 'sso-pending')).toEqual({ v: 2, anything: 'goes', p: 'sso-pending' });
  });

  it('returns null on a tampered token', () => {
    const token = encryptPayload({ a: 1 }, 'session-context');
    const buf = Buffer.from(token, 'base64');
    buf[20] ^= 0xff;
    expect(decryptPayload(buf.toString('base64'), 'session-context')).toBeNull();
  });

  it('refuses a blob minted for another purpose', () => {
    // GHSA-cqqx-mjcf-mh55: an office editor token is authentic under the same
    // key as the session cookie, so only the bound purpose separates them.
    const editorToken = encryptPayload(
      { serverUrl: 'https://mail.example.com', username: 'alice', authHeader: 'Basic abc', fileId: 'd' },
      'wopi-token',
    );
    expect(decryptPayload(editorToken, 'wopi-token')).not.toBeNull();
    expect(decryptPayload(editorToken, 'session-context')).toBeNull();
    expect(decryptPayload(editorToken, 'pair-reauth')).toBeNull();
    expect(decryptPayload(editorToken, 'sso-pending')).toBeNull();
  });

  it('refuses a session cookie presented on any other path', () => {
    const session = encryptPayload(
      { serverUrl: 'https://mail.example.com', username: 'alice', authHeader: 'Basic abc' },
      'session-context',
    );
    expect(decryptPayload(session, 'wopi-token')).toBeNull();
    expect(decryptPayload(session, 'pair-reauth')).toBeNull();
  });

  describe('payloads minted before purposes were bound', () => {
    // Blobs from <= 1.9.3 carry no AAD. They are still opened on the path that
    // minted them - otherwise upgrading logs everyone out - but only there.
    function mintLegacy(payload: Record<string, unknown>): string {
      const key = createHash('sha256').update(SECRET).digest();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    }

    it('still opens a legacy session context', () => {
      const legacy = mintLegacy({ serverUrl: 'https://mail.example.com', username: 'alice', authHeader: 'Basic abc' });
      expect(decryptPayload(legacy, 'session-context')).toMatchObject({ username: 'alice' });
    });

    it('still opens a legacy pairing proof and SSO pending state', () => {
      expect(decryptPayload(mintLegacy({ purpose: 'pair', created_at: 1 }), 'pair-reauth')).toMatchObject({ purpose: 'pair' });
      expect(decryptPayload(mintLegacy({ state: 's', code_verifier: 'v' }), 'sso-pending')).toMatchObject({ state: 's' });
      expect(decryptPayload(mintLegacy({ state: 's', purpose: 'reauth' }), 'sso-pending')).toMatchObject({ purpose: 'reauth' });
    });

    it('does not let a legacy editor token in through the session path', () => {
      const legacyWopi = mintLegacy({
        v: 1, t: 'wopi', serverUrl: 'https://mail.example.com', username: 'alice',
        authHeader: 'Basic abc', fileId: 'd', exp: Date.now() + 1000,
      });
      expect(decryptPayload(legacyWopi, 'session-context')).toBeNull();
      expect(decryptPayload(legacyWopi, 'wopi-token')).toMatchObject({ t: 'wopi' });
    });

    it('does not let a legacy pairing proof in through the session path', () => {
      expect(decryptPayload(mintLegacy({ purpose: 'pair', created_at: 1 }), 'session-context')).toBeNull();
    });
  });
});
