// SHA-256 integrity check for plugin bundles.
//
// The bundle endpoint returns the canonical hash as the ETag. The client
// re-hashes the bytes after fetch and refuses to load on mismatch. This
// closes the gap where a compromised admin route (or transient MITM upstream
// of the CDN/proxy) could swap the bundle silently.
//
// `crypto.subtle` only exists in secure contexts (https / localhost). On a
// plain-http LAN or Tailscale origin it is undefined, which used to throw
// from every bundle load and every user upload (#636). The digest therefore
// falls back to a pure-JS SHA-256 (@noble/hashes, loaded on demand) whenever
// WebCrypto cannot do it; both paths yield the same hex, so the registry
// hash / ETag comparison is unaffected.

function toBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  // Always copy into an exact-size, plain ArrayBuffer (never a
  // SharedArrayBuffer or a view into a larger buffer) so the bytes can be
  // handed to WebCrypto as-is.
  const source = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

/**
 * WebCrypto digest, or `null` when WebCrypto is unavailable (insecure
 * context) or refuses the call - the caller then uses the JS implementation.
 */
async function digestNative(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return null;
  try {
    return new Uint8Array(await subtle.digest('SHA-256', bytes.buffer));
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = toBytes(input);
  const native = await digestNative(bytes);
  if (native) return toHex(native);
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return toHex(sha256(bytes));
}

/**
 * Compare `actual` and `expected` in constant time. Both must be the same
 * length lower-case hex strings. Returns false on any structural mismatch.
 */
export function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify `code` against `expectedHash`. Returns the (normalised) hash on
 * match, throws on mismatch. Pass `null`/`undefined` for `expectedHash` to
 * compute-and-return without verification (used for dev-plugin paths).
 */
export async function verifyBundle(code: string, expectedHash: string | null | undefined): Promise<string> {
  const actual = await sha256Hex(code);
  if (!expectedHash) return actual;
  // Server may quote the hash (it's also used as an ETag); strip and compare.
  const normalised = expectedHash.replace(/^"|"$/g, '').trim().toLowerCase();
  if (!constantTimeHexEqual(actual, normalised)) {
    throw new Error(`Bundle integrity mismatch: expected ${normalised}, got ${actual}`);
  }
  return actual;
}
