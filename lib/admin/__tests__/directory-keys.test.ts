/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { canonicalJson } from '@/lib/extension-package';
import { checkBundleSignature, clearKeyringCache, keyIdOf, OFFICIAL_DIRECTORY, rootKeysFor } from '../directory-keys';

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  return { privateKey, raw: raw.toString('base64'), keyId: keyIdOf(raw) };
}

const sig = (key: KeyObject, text: string) => sign(null, Buffer.from(text, 'utf8'), key).toString('base64');

const DIR = 'https://directory.test';
const root = keypair();
const online = keypair();
const bytes = new TextEncoder().encode('zip bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function keyring(status: 'active' | 'revoked' = 'active', signer = root) {
  const body = {
    _type: 'https://extensions.bulwarkmail.org/keyring/v1',
    rootKeyId: signer.keyId,
    issuedAt: '2026-10-14T00:00:00.000Z',
    keys: [{ keyId: online.keyId, publicKey: online.raw, status, notBefore: '2026-10-14T00:00:00.000Z', notAfter: null }],
  };
  return { ...body, signature: sig(signer.privateKey, canonicalJson(body)) };
}

function signedHeaders(over: Record<string, unknown> = {}, key = online) {
  const statement = canonicalJson({
    _type: 'https://extensions.bulwarkmail.org/release/v1', slug: 'jitsi-meet', version: '1.2.0', kind: 'plugin',
    bundle: { sha256, size: bytes.byteLength }, source: { host: 'github.com', repo: 'o/r', commit: 'c'.repeat(40), subpath: '' },
    approvedAt: '2026-10-14T00:00:00.000Z', ...over,
  });
  return new Headers({
    'x-bundle-statement': Buffer.from(statement, 'utf8').toString('base64'),
    'x-bundle-signature': sig(key.privateKey, statement),
    'x-bundle-signature-key': key.keyId,
  });
}

const fetchKeyring = (doc: unknown): typeof fetch => (async () => Response.json(doc)) as typeof fetch;

const check = (headers: Headers, opts: { ring?: unknown; configured?: string | null; dir?: string; version?: string; data?: Uint8Array } = {}) =>
  checkBundleSignature({
    directoryUrl: opts.dir ?? DIR,
    configuredRootKeys: opts.configured === undefined ? root.raw : opts.configured,
    slug: 'jitsi-meet', version: opts.version ?? '1.2.0', kind: 'plugin',
    bytes: opts.data ?? bytes, headers, fetchImpl: fetchKeyring(opts.ring ?? keyring()),
  });

beforeEach(() => clearKeyringCache());

describe('checkBundleSignature', () => {
  it('accepts a bundle signed by an online key from a root-signed keyring', async () => {
    expect(await check(signedHeaders())).toMatchObject({ status: 'verified', keyId: online.keyId, commit: 'c'.repeat(40) });
  });

  it('refuses a bundle whose bytes changed', async () => {
    expect(await check(signedHeaders(), { data: new TextEncoder().encode('zip bytez') })).toMatchObject({ status: 'invalid' });
  });

  it('refuses a valid signature for another extension or version', async () => {
    expect(await check(signedHeaders({ slug: 'other' }))).toMatchObject({ status: 'invalid', reason: expect.stringContaining('not jitsi-meet') });
    expect(await check(signedHeaders(), { version: '1.3.0' })).toMatchObject({ status: 'invalid' });
  });

  it('refuses a key the keyring revoked, or one it does not list', async () => {
    expect(await check(signedHeaders(), { ring: keyring('revoked') })).toMatchObject({ status: 'invalid', reason: expect.stringContaining('revoked') });
    expect(await check(signedHeaders({}, keypair()))).toMatchObject({ status: 'invalid', reason: expect.stringContaining('unknown key') });
  });

  it('refuses a keyring signed by a root key it does not trust', async () => {
    expect(await check(signedHeaders(), { ring: keyring('active', keypair()) })).toMatchObject({ status: 'invalid', reason: expect.stringContaining('trusted root') });
  });

  it('refuses an unsigned bundle when root keys are known', async () => {
    expect(await check(new Headers())).toMatchObject({ status: 'invalid', reason: expect.stringContaining('not signed') });
  });

  it('lets an unsigned bundle through from a directory with no known root keys', async () => {
    expect(await check(new Headers(), { configured: '' })).toEqual({ status: 'unsigned' });
  });

  it('always knows the official directory root key', () => {
    expect(Object.keys(rootKeysFor(OFFICIAL_DIRECTORY, null))).toHaveLength(1);
    expect(rootKeysFor('https://self-hosted.example', null)).toEqual({});
  });
});
