/**
 * The organisation's maximum session length (policy.json
 * `organisation.session.maxHours`) on the server side.
 *
 * JMAP goes from the browser straight to Stalwart, so the client's timer
 * signs users out on time (components/session/session-timeout-guard.tsx).
 * The server's part is to stop a session older than the maximum from coming
 * back: the routes that restore a remembered sign-in (/api/auth/session) or
 * renew a provider token (/api/auth/token) refuse it and clear its cookies.
 *
 * The sign-in time travels in the remembered-session cookie (`signedInAt`
 * in lib/auth/crypto.ts), in the auth-context cookie, and for token
 * sign-ins in a small cookie of its own written when the refresh token is
 * (the auth-context cookie ends with the browser, the refresh token lasts
 * 30 days). A cookie written before this existed has no sign-in time: it
 * counts as signed in when the server first sees it after the upgrade,
 * which then writes the time into it.
 *
 * The server knows an account's address, not its groups, so only Everyone
 * and the domain scopes count here; a group scope's value is enforced by the
 * client alone.
 */

import type { cookies } from 'next/headers';
import { configManager } from '@/lib/admin/config-manager';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { decryptPayload, encryptPayload } from '@/lib/auth/crypto';
import { getCookieOptions } from '@/lib/oauth/cookie-config';
import { logger } from '@/lib/logger';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const HOUR_MS = 60 * 60 * 1000;

/** What a route answers when it refuses a session that is too old. */
export const SESSION_TOO_OLD = 'session_expired';

/** The maximum session length (hours, 0 = none) for an account's address. */
export async function maxSessionHoursFor(account: string | null | undefined): Promise<number> {
  try {
    await configManager.ensureLoaded?.();
    const email = account?.trim().toLowerCase() ?? '';
    const policy = resolvePolicy(configManager.getPolicy(), email ? { email, groups: [] } : null).policy;
    const hours = policy.organisation?.session?.maxHours;
    return typeof hours === 'number' && hours > 0 ? hours : 0;
  } catch (error) {
    logger.warn('Could not read the maximum session length', { error: error instanceof Error ? error.message : 'Unknown error' });
    return 0;
  }
}

/** Whether a session signed in at `signedInAt` has outlived `maxHours`. */
export function isPastMaxAge(signedInAt: number | undefined, maxHours: number, now = Date.now()): boolean {
  if (!maxHours || typeof signedInAt !== 'number') return false;
  return now - signedInAt >= maxHours * HOUR_MS;
}

export function validSignedInAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The sign-in time of a token sign-in, kept as long as its refresh token.
 * `account` is filled in once the auth context names the account.
 */
export interface SignInStamp {
  signedInAt: number;
  account?: string;
}

export function signInStampCookieName(slot: number): string {
  return slot === 0 ? 'jmap_signed_in' : `jmap_signed_in_${slot}`;
}

export function readSignInStamp(cookieStore: CookieStore, slot: number): SignInStamp | null {
  const value = cookieStore.get(signInStampCookieName(slot))?.value;
  if (!value) return null;
  try {
    const payload = decryptPayload(value, 'session-age');
    const signedInAt = validSignedInAt(payload?.signedInAt);
    if (!signedInAt) return null;
    return typeof payload?.account === 'string' ? { signedInAt, account: payload.account } : { signedInAt };
  } catch {
    return null;
  }
}

/** Without a session secret nothing can be sealed; the client's timer still applies. */
export function writeSignInStamp(cookieStore: CookieStore, slot: number, stamp: SignInStamp): void {
  try {
    const payload: Record<string, unknown> = { signedInAt: stamp.signedInAt };
    if (stamp.account) payload.account = stamp.account;
    cookieStore.set(signInStampCookieName(slot), encryptPayload(payload, 'session-age'), getCookieOptions());
  } catch (error) {
    logger.warn('Could not record the sign-in time', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export function clearSignInStamp(cookieStore: CookieStore, slot: number): void {
  const name = signInStampCookieName(slot);
  if (cookieStore.get(name)) cookieStore.delete(name);
}
