// Client-side Ed25519 verification for plugin bundles.
//
// On boot the loader fetches the host's public key from
// `/api/plugin-signing-pubkey`. Each `/api/admin/plugins/[id]/bundle` response
// includes the signature as the `X-Bundle-Signature` header. Before evaluating
// a bundle the loader verifies the signature; mismatch refuses the load.
//
// User-installed plugins (uploaded via the file picker, no server hop) have
// no signature - verification is skipped for those, since the user is
// installing their own code. Verification kicks in for server-managed
// bundles only (the `managed: true` flag on `InstalledPlugin`).
//
// WebCrypto is the primary verifier, but it is not always there:
//   - `crypto.subtle` is undefined on insecure origins (plain http on a LAN
//     or Tailscale host), which used to fail every managed bundle closed and
//     left users with an empty plugin list (#636);
//   - Ed25519 only reached WebCrypto in Chrome 137 / Firefox 130 / Safari 17.
// In both cases the check falls back to a pure-JS implementation
// (@noble/curves, loaded on demand) instead of being skipped, so a bundle is
// still only ever loaded after a successful verification.

import { apiFetch } from '@/lib/browser-navigation';

const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;

/** Raw 32-byte host public key, cached for the lifetime of the page. */
let cachedPublicKey: Uint8Array | null = null;
let publicKeyPromise: Promise<Uint8Array | null> | null = null;
/**
 * The same key imported into WebCrypto. Resolves to `null` when the browser
 * has no `crypto.subtle` or cannot import Ed25519 keys; the JS verifier is
 * used in that case.
 */
let nativeKeyPromise: Promise<CryptoKey | null> | null = null;

function getSubtle(): SubtleCrypto | null {
  return typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
}

async function fetchPublicKey(): Promise<Uint8Array | null> {
  try {
    const res = await apiFetch('/api/plugin-signing-pubkey', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json() as { algorithm?: string; publicKey?: string };
    if (data.algorithm !== 'ed25519' || typeof data.publicKey !== 'string') return null;
    const raw = base64ToBytes(data.publicKey);
    if (raw.length !== PUBLIC_KEY_LENGTH) return null;
    return raw;
  } catch (err) {
    console.warn('[plugin-signing] could not fetch public key', err);
    return null;
  }
}

/** The host's raw Ed25519 public key (32 bytes), or `null` when unavailable. */
export async function getPluginSigningKey(): Promise<Uint8Array | null> {
  if (cachedPublicKey) return cachedPublicKey;
  if (!publicKeyPromise) {
    publicKeyPromise = fetchPublicKey().then((k) => { cachedPublicKey = k; return k; });
  }
  return publicKeyPromise;
}

/** Force a refresh on next access (e.g. after key rotation). */
export function invalidatePluginSigningKeyCache(): void {
  cachedPublicKey = null;
  publicKeyPromise = null;
  nativeKeyPromise = null;
}

async function importNativeKey(raw: Uint8Array): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  try {
    // Browser Web Crypto supports Ed25519 via `name: 'Ed25519'` (no hash).
    return await subtle.importKey('raw', raw.slice().buffer, { name: 'Ed25519' }, false, ['verify']);
  } catch (err) {
    console.warn('[plugin-signing] Web Crypto cannot import Ed25519 keys here; using the JavaScript verifier', err);
    return null;
  }
}

/**
 * Verify with WebCrypto. Resolves `null` when WebCrypto could not perform the
 * check at all (no `crypto.subtle`, no Ed25519 support) - that is not a
 * verdict on the signature and the caller falls back to the JS verifier.
 */
async function verifyNative(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean | null> {
  if (!getSubtle()) return null;
  if (!nativeKeyPromise) nativeKeyPromise = importNativeKey(publicKey);
  const key = await nativeKeyPromise;
  const subtle = getSubtle();
  if (!key || !subtle) return null;
  try {
    return await subtle.verify({ name: 'Ed25519' }, key, signature.slice().buffer, data.slice().buffer);
  } catch (err) {
    console.warn('[plugin-signing] Web Crypto Ed25519 verify failed to run; using the JavaScript verifier', err);
    return null;
  }
}

async function verifyWithJs(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  return ed25519.verify(signature, data, publicKey);
}

/**
 * Verify a base64 Ed25519 signature against the bundle bytes. Returns false
 * on any failure (missing key, invalid encoding, signature mismatch, no
 * usable verifier). Never throws.
 */
export async function verifySignature(code: string, signatureB64: string): Promise<boolean> {
  if (!signatureB64) return false;
  const publicKey = await getPluginSigningKey();
  if (!publicKey) return false;
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signatureB64);
  } catch {
    return false;
  }
  if (signature.length !== SIGNATURE_LENGTH) return false;
  const data = new TextEncoder().encode(code);

  const native = await verifyNative(publicKey, signature, data);
  if (native !== null) return native;
  try {
    return await verifyWithJs(publicKey, signature, data);
  } catch (err) {
    console.error('[plugin-signing] JavaScript Ed25519 verification failed to run', err);
    return false;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
