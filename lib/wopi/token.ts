import { encryptPayload, decryptPayload } from '@/lib/auth/crypto';

/**
 * WOPI access tokens (#425).
 *
 * The WOPI client (Collabora / OnlyOffice / EuroOffice, ...) receives this
 * token in the launch form POST and echoes it back on every WOPI call
 * (CheckFileInfo, GetFile, PutFile). It is an AES-256-GCM blob keyed off
 * SESSION_SECRET - opaque to the editor - carrying the stored Stalwart
 * credentials plus the one file node it is scoped to. The editor can
 * therefore only reach the /api/wopi/files/<fileId> surface for that node,
 * never the JMAP server itself.
 */

export interface WopiTokenPayload {
  serverUrl: string;
  authHeader: string;
  username: string;
  accountId: string;
  fileId: string;
  canWrite: boolean;
  /** Browser origin that embeds the editor iframe (WOPI PostMessageOrigin). */
  origin: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export const WOPI_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

// The token travels as a form field and is re-embedded into URLs by the
// editor. Standard base64 breaks on that trip: '+' decodes to a space under
// x-www-form-urlencoded rules and '/' needs escaping, so the token is issued
// in the URL-safe alphabet (base64url) instead.
function toBase64Url(token: string): string {
  return token.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): string {
  // Also map stray spaces back to '+' in case an intermediary applied
  // form-urlencoded decoding to a legacy standard-base64 token.
  return token.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
}

export function mintWopiToken(payload: Omit<WopiTokenPayload, 'exp'>): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + WOPI_TOKEN_TTL_MS;
  const token = toBase64Url(encryptPayload({ v: 1, t: 'wopi', ...payload, exp: expiresAt }, 'wopi-token'));
  return { token, expiresAt };
}

/**
 * Decrypt and validate a WOPI access token. `fileId` must match the id in
 * the request URL so a token for one document cannot address another.
 */
export function verifyWopiToken(token: string | null, fileId: string): WopiTokenPayload | null {
  if (!token) return null;
  const raw = decryptPayload(fromBase64Url(token), 'wopi-token');
  if (!raw || raw.v !== 1 || raw.t !== 'wopi') return null;
  const p = raw as unknown as WopiTokenPayload;
  if (
    typeof p.serverUrl !== 'string' || !p.serverUrl ||
    typeof p.authHeader !== 'string' || !p.authHeader ||
    typeof p.accountId !== 'string' || !p.accountId ||
    typeof p.fileId !== 'string' || !p.fileId ||
    typeof p.exp !== 'number'
  ) return null;
  if (p.fileId !== fileId) return null;
  if (Date.now() > p.exp) return null;
  return p;
}
