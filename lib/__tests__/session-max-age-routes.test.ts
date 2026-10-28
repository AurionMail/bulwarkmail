// @vitest-environment node
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SettingsPolicy } from '@/lib/admin/types';

/**
 * The organisation's maximum session length on the server: the routes that
 * restore a remembered sign-in or renew a provider token refuse a session
 * older than `maxHours` of the account's domain scopes. A cookie or token
 * without a sign-in time counts from one fixed time, when the server first
 * enforced the limits, so deleting the stamp or keeping an old cookie never
 * makes a session younger.
 */

const SECRET = 's'.repeat(64);
vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => SECRET, hasSessionSecret: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@/lib/telemetry/login-tracker', () => ({ recordLogin: () => {} }));
vi.mock('@/lib/oauth/cookie-config', () => ({
  getCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 2592000 }),
}));

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (arg: string | { name: string }) => { jar.delete(typeof arg === 'string' ? arg : arg.name); },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  }),
}));

let policy: Partial<SettingsPolicy>;
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: async () => {},
    get: (key: string, fallback: unknown) => (key === 'jmapServerUrl' ? 'https://mail.example.org' : fallback),
    getPolicy: () => policy,
  },
}));

vi.mock('@/lib/auth/verify-jmap-auth', () => ({
  JmapAuthVerificationError: class extends Error { status = 401; },
  resolveJmapIdentity: async (serverUrl: string, _auth: string, username: string) => ({ serverUrl, accountName: username }),
}));

vi.mock('@/lib/oauth/token-exchange', () => ({
  exchangeCodeForTokens: async () => ({ access_token: 'first-access', refresh_token: 'refresh-1', expires_in: 300 }),
  buildOAuthParams: (params: Record<string, string>) => new URLSearchParams(params),
  getMetadata: async () => ({ revocation_endpoint: 'https://id.example.org/revoke' }),
  getRequiredConfig: () => ({ clientId: 'webmail' }),
  getTokenEndpoint: async () => 'https://id.example.org/token',
  defaultClientOptions: async () => ({ fallbackClientId: 'bulwark-webmail' }),
  DEFAULT_CLIENT_ID: 'bulwark-webmail',
}));

const stateDir = mkdtempSync(path.join(tmpdir(), 'bw-session-age-'));
process.env.ADMIN_STATE_DIR = stateDir;
afterAll(() => rmSync(stateDir, { recursive: true, force: true }));

const { encryptSession, decryptSession } = await import('@/lib/auth/crypto');
const { readSignInStamp, writeSignInStamp, limitsEnforcedSince, resetLimitsEnforcedSince } = await import('@/lib/auth/session-age');
const sessionRoute = await import('@/app/api/auth/session/route');
const tokenRoute = await import('@/app/api/auth/token/route');
const contextRoute = await import('@/app/api/auth/stalwart-context/route');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-28T12:00:00Z').getTime();
const SERVER = 'https://mail.example.org';
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };

/** Eight hours for example.org, nothing for everyone else. */
function policyWithDomainMax(hours: number): Partial<SettingsPolicy> {
  return {
    features: {} as never, restrictions: {}, defaults: {},
    scopes: [{ id: 'example', label: 'example.org', match: { domains: ['example.org'] }, policy: { organisation: { session: { maxHours: hours } } } }],
  };
}

/** A remembered-session cookie as Bulwark wrote it before sign-in times were recorded. */
function legacySessionCookie(username: string, password: string): string {
  const key = createHash('sha256').update(SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ v: 1, serverUrl: SERVER, username, password }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

const store = async () => (await (await import('next/headers')).cookies()) as never;
const restore = () => sessionRoute.PUT(new NextRequest('https://webmail.example/api/auth/session', { method: 'PUT', headers: SAME_ORIGIN }));
const peek = () => sessionRoute.GET(new NextRequest('https://webmail.example/api/auth/session'));
const refresh = () => tokenRoute.PUT(new NextRequest('https://webmail.example/api/auth/token?slot=0&force=true', { method: 'PUT', headers: SAME_ORIGIN }));
const signInWithProvider = () => tokenRoute.POST(new NextRequest('https://webmail.example/api/auth/token?slot=0', {
  method: 'POST',
  headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'c', code_verifier: 'v', redirect_uri: 'https://webmail.example/auth/callback', slot: 0 }),
}));

let issued = 0;
const tokenFetch = vi.fn();

beforeEach(async () => {
  jar.clear();
  rmSync(path.join(stateDir, 'session-limits-since'), { force: true });
  resetLimitsEnforcedSince();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // The server enforces the limits from NOW on.
  expect(await limitsEnforcedSince()).toBe(NOW);
  policy = policyWithDomainMax(8);
  issued = 0;
  tokenFetch.mockReset();
  tokenFetch.mockImplementation(async (url: string) => {
    // The provider rotates the refresh token on every renewal.
    if (url.endsWith('/token')) return Response.json({ access_token: 'new-access', refresh_token: `rotated-${++issued}`, expires_in: 300 });
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', tokenFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the time the limits were first enforced', () => {
  it('is recorded once and kept across restarts', async () => {
    vi.setSystemTime(NOW + 5 * HOUR);
    resetLimitsEnforcedSince();
    expect(await limitsEnforcedSince()).toBe(NOW);
  });
});

describe('remembered sessions (/api/auth/session)', () => {
  it('records the sign-in time when the session is remembered, and answers with it', async () => {
    const res = await sessionRoute.POST(new NextRequest('https://webmail.example/api/auth/session?slot=0', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: SERVER, username: 'org-alice@example.org', password: 'pw' }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signedInAt: NOW });
    expect(decryptSession(jar.get('jmap_session')!)?.signedInAt).toBe(NOW);
  });

  it('restores a session younger than the maximum and says when it signed in', async () => {
    jar.set('jmap_session', encryptSession(SERVER, 'org-alice@example.org', 'pw', NOW - 7 * HOUR));
    const res = await restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ serverUrl: SERVER, username: 'org-alice@example.org', password: 'pw', signedInAt: NOW - 7 * HOUR });
  });

  it('refuses a session older than its domain allows and clears its cookies', async () => {
    jar.set('jmap_session', encryptSession(SERVER, 'org-alice@example.org', 'pw', NOW - 8 * HOUR));
    jar.set('jmap_stalwart_ctx', 'stale');

    const res = await restore();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_expired', maxHours: 8 });
    expect(jar.has('jmap_session')).toBe(false);
    expect(jar.has('jmap_stalwart_ctx')).toBe(false);

    jar.set('jmap_session', encryptSession(SERVER, 'org-alice@example.org', 'pw', NOW - 9 * HOUR));
    expect((await peek()).status).toBe(401);
  });

  it('leaves an account of another domain alone', async () => {
    jar.set('jmap_session', encryptSession(SERVER, 'org-dave@org-two.test', 'pw', NOW - 100 * HOUR));
    expect((await restore()).status).toBe(200);
  });

  it('applies the maximum of Everyone to every domain', async () => {
    policy = { ...policyWithDomainMax(8), organisation: { session: { idleMinutes: 0, maxHours: 24, warnSeconds: 60 } } as never };
    jar.set('jmap_session', encryptSession(SERVER, 'org-dave@org-two.test', 'pw', NOW - 25 * HOUR));
    expect((await restore()).status).toBe(401);
  });

  it('counts a cookie without a sign-in time from the fixed time, without rewriting it', async () => {
    const legacy = legacySessionCookie('org-alice@example.org', 'pw');
    jar.set('jmap_session', legacy);

    vi.setSystemTime(NOW + 7 * HOUR);
    const first = await restore();
    expect(first.status).toBe(200);
    expect((await first.json()).signedInAt).toBe(NOW);
    expect(jar.get('jmap_session')).toBe(legacy);

    vi.setSystemTime(NOW + 8 * HOUR);
    expect((await restore()).status).toBe(401);
  });

  it('refuses a kept copy of an old cookie replayed later', async () => {
    const legacy = legacySessionCookie('org-alice@example.org', 'pw');
    // First seen only now, nine hours after the server started enforcing.
    vi.setSystemTime(NOW + 9 * HOUR);
    jar.set('jmap_session', legacy);
    expect((await restore()).status).toBe(401);
    jar.set('jmap_session', legacy);
    expect((await peek()).status).toBe(401);
  });
});

describe('provider tokens (/api/auth/token)', () => {
  it('records the sign-in time with the refresh token when a provider sign-in stores it', async () => {
    const res = await signInWithProvider();
    expect(res.status).toBe(200);
    expect((await res.json()).signed_in_at).toBe(NOW);
    expect(readSignInStamp(await store(), 0, 'refresh-1')).toMatchObject({ signedInAt: NOW });
    // The stamp belongs to that token only.
    expect(readSignInStamp(await store(), 0, 'another-token')).toBeNull();
  });

  it('refuses to renew a token sign-in older than the maximum and revokes it', async () => {
    jar.set('jmap_rt', 'refresh-1');
    writeSignInStamp(await store(), 0, { signedInAt: NOW + HOUR, refreshToken: 'refresh-1', account: 'org-alice@example.org' });

    vi.setSystemTime(NOW + 9 * HOUR);
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_expired', maxHours: 8 });
    expect(jar.has('jmap_rt')).toBe(false);
    expect(jar.has('jmap_signed_in')).toBe(false);
    expect(tokenFetch).toHaveBeenCalledWith('https://id.example.org/revoke', expect.anything());
    expect(tokenFetch).not.toHaveBeenCalledWith('https://id.example.org/token', expect.anything());
  });

  it('renews a younger one, and the stamp follows the rotated token with the same time', async () => {
    await signInWithProvider();
    vi.setSystemTime(NOW + 3 * HOUR);

    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ access_token: 'new-access', signed_in_at: NOW });
    expect(jar.get('jmap_rt')).toBe('rotated-1');
    expect(readSignInStamp(await store(), 0, 'rotated-1')).toMatchObject({ signedInAt: NOW });

    vi.setSystemTime(NOW + 7 * HOUR);
    expect((await refresh()).status).toBe(200);
    vi.setSystemTime(NOW + 8 * HOUR);
    expect((await refresh()).status).toBe(401);
  });

  it('counts a refresh token without a stamp from the fixed time and binds that time to it', async () => {
    jar.set('jmap_rt', 'refresh-legacy');
    vi.setSystemTime(NOW + HOUR);

    const res = await refresh();
    expect(res.status).toBe(200);
    expect((await res.json()).signed_in_at).toBe(NOW);
    expect(readSignInStamp(await store(), 0, 'rotated-1')).toMatchObject({ signedInAt: NOW });

    vi.setSystemTime(NOW + 8 * HOUR);
    expect((await refresh()).status).toBe(401);
  });

  it('does not make a session younger when its stamp is deleted', async () => {
    vi.setSystemTime(NOW + 5 * HOUR);
    await signInWithProvider();
    jar.delete('jmap_signed_in');

    vi.setSystemTime(NOW + 8 * HOUR);
    const res = await refresh();
    expect(res.status).toBe(401);
  });

  it('applies the domain of the account the stamp names', async () => {
    jar.set('jmap_rt', 'refresh-1');
    writeSignInStamp(await store(), 0, { signedInAt: NOW, refreshToken: 'refresh-1', account: 'org-dave@org-two.test' });
    vi.setSystemTime(NOW + 100 * HOUR);
    expect((await refresh()).status).toBe(200);
  });

  it('does not take a stamp written for another refresh token', async () => {
    jar.set('jmap_rt', 'refresh-2');
    writeSignInStamp(await store(), 0, { signedInAt: NOW + 7 * HOUR, refreshToken: 'refresh-1' });

    vi.setSystemTime(NOW + 8 * HOUR);
    expect((await refresh()).status).toBe(401);
  });
});

describe('the auth context (/api/auth/stalwart-context)', () => {
  it("names the account on a token sign-in's stamp", async () => {
    await signInWithProvider();
    const res = await contextRoute.POST(new NextRequest('https://webmail.example/api/auth/stalwart-context', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: SERVER, username: 'org-alice@example.org', authHeader: 'Bearer new', slot: 0 }),
    }));
    expect(res.status).toBe(200);
    expect(readSignInStamp(await store(), 0, 'refresh-1')).toMatchObject({ signedInAt: NOW, account: 'org-alice@example.org' });
  });
});
