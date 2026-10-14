// Input checks shared by the plugin host API. Everything a plugin sends
// arrives through postMessage and is untrusted: these helpers turn it into
// the exact types the host works with, or throw an error that names the
// method and the field, which the plugin sees as the rejection message.

import { useAuthStore } from '@/stores/auth-store';
import type { IJMAPClient } from '../jmap/client-interface';
import { isValidEmail } from '../validation';

/**
 * Largest body the host hands a plugin in one answer: an http.fetch
 * response, an attachment or a message source. It is copied across
 * postMessage, so an unbounded one could take the tab down. Bigger transfers
 * go through the server proxy.
 */
export const MAX_PLUGIN_FETCH_BYTES = 25 * 1024 * 1024;

/** Longest id (event, task, template, email, blob, ...) a plugin may pass. */
export const MAX_PLUGIN_ID_LENGTH = 256;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The session's JMAP client, or an error naming the method. */
export function sessionClient(method: string): IJMAPClient {
  const { client } = useAuthStore.getState();
  if (!client) throw new Error(`${method}: no active session`);
  return client;
}

/**
 * A plain object with only the listed keys. Unknown keys are refused rather
 * than ignored, so a misspelt field fails loudly instead of doing nothing.
 */
export function readObject(
  value: unknown,
  method: string,
  field: string,
  allowed: readonly string[],
  optional = false,
): Record<string, unknown> {
  if (value === undefined && optional) return {};
  if (!isPlainRecord(value)) throw new Error(`${method}: ${field} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${method}: ${field} has an unknown property "${key}"`);
  }
  return value;
}

export function readId(value: unknown, method: string, field = 'id'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PLUGIN_ID_LENGTH) {
    throw new Error(`${method}: ${field} must be a string of 1-${MAX_PLUGIN_ID_LENGTH} characters`);
  }
  return value;
}

export function readString(
  value: unknown,
  method: string,
  field: string,
  max: number,
  { min = 0, trim = false }: { min?: number; trim?: boolean } = {},
): string {
  if (typeof value !== 'string') throw new Error(`${method}: ${field} must be a string`);
  const text = trim ? value.trim() : value;
  if (text.length < min || text.length > max) {
    throw new Error(min > 0
      ? `${method}: ${field} must be ${min}-${max} characters`
      : `${method}: ${field} must be at most ${max} characters`);
  }
  return text;
}

export function readOptionalString(
  value: unknown,
  method: string,
  field: string,
  max: number,
): string | undefined {
  return value === undefined ? undefined : readString(value, method, field, max);
}

export function readBoolean(value: unknown, method: string, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${method}: ${field} must be true or false`);
  return value;
}

export function readInteger(value: unknown, method: string, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${method}: ${field} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/**
 * Recipient addresses: `alice@example.com` or `Alice <alice@example.com>`.
 * Returned trimmed, in the form given. Refuses anything with line breaks.
 */
export function readAddressList(value: unknown, method: string, field: string, max: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${method}: ${field} must be an array of addresses`);
  if (value.length > max) throw new Error(`${method}: ${field} may hold at most ${max} addresses`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length > 320) {
      throw new Error(`${method}: ${field}[${index}] must be an address`);
    }
    const trimmed = entry.trim();
    const match = /^(?:"?([^"<>\r\n]*)"?\s*)?<([^<>\s]+)>$/.exec(trimmed);
    const address = match ? match[2] : trimmed;
    if (!isValidEmail(address)) throw new Error(`${method}: ${field}[${index}] is not a valid address`);
    return trimmed;
  });
}

/** Just the address part of `Name <addr>` (or the address itself). */
export function addressOf(entry: string): string {
  const match = /<([^<>\s]+)>$/.exec(entry);
  return match ? match[1] : entry;
}

/** The display name of `Name <addr>`, or ''. */
export function nameOf(entry: string): string {
  const match = /^"?([^"<>]*)"?\s*<[^<>]+>$/.exec(entry);
  return match ? match[1].trim() : '';
}

const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export interface PluginBlobRef {
  blobId: string;
  name: string;
  type: string;
  size: number;
}

/**
 * Attachments a plugin uploaded itself (`jmap.uploadBlob`) and wants on a
 * message: blob id, file name, media type and size.
 */
export function readBlobRefs(
  value: unknown,
  method: string,
  maxCount: number,
  maxSize: number,
): PluginBlobRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${method}: attachments must be an array`);
  if (value.length > maxCount) throw new Error(`${method}: at most ${maxCount} attachments are allowed`);
  return value.map((entry, index) => {
    const field = `attachments[${index}]`;
    const ref = readObject(entry, method, field, ['blobId', 'name', 'type', 'size']);
    const type = readString(ref.type, method, `${field}.type`, 255);
    if (!MIME_TYPE_RE.test(type)) throw new Error(`${method}: ${field}.type is not a media type`);
    return {
      blobId: readId(ref.blobId, method, `${field}.blobId`),
      // eslint-disable-next-line no-control-regex -- control characters in a file name are refused
      name: readString(ref.name, method, `${field}.name`, 255, { min: 1 }).replace(/[\u0000-\u001f\u007f]/g, ''),
      type,
      size: readInteger(ref.size, method, `${field}.size`, 0, maxSize),
    };
  });
}

// ─── Rate limits ──────────────────────────────────────────────

const recentCalls = new Map<string, number[]>();

/** True when `pluginId` made fewer than `max` `kind` calls in the last minute; records this one. */
export function withinRate(kind: string, pluginId: string, max: number, windowMs = 60_000): boolean {
  const key = `${kind}\u0000${pluginId}`;
  const now = Date.now();
  const recent = (recentCalls.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    recentCalls.set(key, recent);
    return false;
  }
  recent.push(now);
  recentCalls.set(key, recent);
  return true;
}

/** Forget the rate-limit history (tests). */
export function resetPluginRateLimits(): void {
  recentCalls.clear();
}
