/**
 * The organisation's session limits (policy.json `organisation.session`) as
 * they apply to this browser. Every account signed in here has its own
 * effective policy (its domain and group scopes); the browser follows the
 * strictest: the shortest idle time any of them sets, and the first
 * maximum session length to run out. 0 is off, so it never wins.
 */

import { DEFAULT_ORGANISATION_POLICY, type OrganisationPolicy } from '@/lib/admin/organisation-policy';

export type SessionPolicy = OrganisationPolicy['session'];

export interface AccountSession {
  session: SessionPolicy | undefined;
  /** When the account signed in (ms); its maximum session length counts from here. */
  signedInAt?: number;
}

export interface SessionLimits {
  idle: { minutes: number; warnSeconds: number } | null;
  /** `at`: when the first account's maximum session length runs out, a minute early (MAX_SKEW_MARGIN_MS). */
  max: { at: number; hours: number; warnSeconds: number } | null;
}

export const NO_SESSION_LIMITS: SessionLimits = { idle: null, max: null };

const HOUR_MS = 60 * 60 * 1000;

/**
 * The browser ends a maximum session length this much before the server
 * would refuse it, so a clock that runs a little behind the server's still
 * warns first.
 */
export const MAX_SKEW_MARGIN_MS = 60 * 1000;

export function sessionLimits(accounts: readonly AccountSession[]): SessionLimits {
  let idle: SessionLimits['idle'] = null;
  let max: SessionLimits['max'] = null;
  for (const account of accounts) {
    const session = account.session ?? DEFAULT_ORGANISATION_POLICY.session;
    const warnSeconds = session.warnSeconds;
    if (session.idleMinutes > 0 && (!idle || session.idleMinutes < idle.minutes)) {
      idle = { minutes: session.idleMinutes, warnSeconds };
    }
    if (session.maxHours > 0 && typeof account.signedInAt === 'number') {
      const at = account.signedInAt + session.maxHours * HOUR_MS - MAX_SKEW_MARGIN_MS;
      if (!max || at < max.at) max = { at, hours: session.maxHours, warnSeconds };
    }
  }
  return { idle, max };
}

export function sameLimits(a: SessionLimits, b: SessionLimits): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let current: SessionLimits | null = null;

/** The limits the guard counts with, for readers outside React (the plugin settings view). */
export function setCurrentSessionLimits(limits: SessionLimits | null): void {
  current = limits;
}

/** Null before the guard has looked at the signed-in accounts. */
export function currentSessionLimits(): SessionLimits | null {
  return current;
}
