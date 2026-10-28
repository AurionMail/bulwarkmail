// @vitest-environment node
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SettingsPolicy } from '@/lib/admin/types';

/**
 * The organisation's maximum session length on the server: the routes that
 * restore a remembered sign-in or renew a provider token refuse a session
 * older than `maxHours` of the account's domain scopes, and a cookie from
 * before sign-in times were recorded counts as signed in when first seen.
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

const tokenFetch = vi.fn();
vi.mock('@/lib/oauth/token-exchange', () => ({
  exchangeCodeForTokens: async () => ({ access_token: 'first-access', refresh_token: 'refresh-1', expires_in: 300 }),
  buildOAuthParams: (params: Record<string, string>) => new URLSearchParams(params),
  getMetadata: async () => ({ revocation_endpoint: 'https://id.example.org/revoke' }),
  getRequiredConfig: () => ({ clientId: 'webmail' }),
  getTokenEndpoint: async () => 'https://id.example.org/token',
  defaultClientOptions: async () => ({ fallbackClientId: 'bulwark-webmail' }),
  DEFAULT_CLIENT_ID: 'bulwark-webmail',
}));

const { encryptSession, decryptSession, decryptPayload } = await import('@/lib/auth/crypto');
const { readSignInStamp, writeSignInStamp } = await import('@/lib/auth/session-age');
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

const restore = () => sessionRoute.PUT(new NextRequest('https://webmail.example/api/auth/session', { method: 'PUT', headers: SAME_ORIGIN }));
const peek = () => sessionRoute.GET(new NextRequest('https://webmail.example/api/auth/session'));
const refresh = () => tokenRoute.PUT(new NextRequest('https://webmail.example/api/auth/token?slot=0', { method: 'PUT', headers: SAME_ORIGIN }));
const context = () => decryptPayload(jar.get('jmap_stalwart_ctx')!, 'session-context');

beforeEach(() => {
  jar.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  policy = policyWithDomainMax(8);
  tokenFetch.mockReset();
  tokenFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'new-access', expires_in: 300 });
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', tokenFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('remembered sessions (/api/auth/session)', () => {
  it('records the sign-in time when the session is remembered', async () => {
    const res = await sessionRoute.POST(new NextRequest('https://webmail.example/api/auth/session?slot=0', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: SERVER, username: 'org-alice@example.org', password: 'pw' }),
    }));
    expect(res.status).toBe(200);
    expect(decryptSession(jar.get('jmap_session')!)?.signedInAt).toBe(NOW);
    expect(context()?.signedInAt).toBe(NOW);
  });

  it('restores a session younger than the maximum, without the sign-in time in the answer', async () => {
    jar.set('jmap_session', encryptSession(SERVER, 'org-alice@example.org', 'pw', NOW - 7 * HOUR));
    const res = await restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ serverUrl: SERVER, username: 'org-alice@example.org', password: 'pw' });
    expect(context()?.signedInAt).toBe(NOW - 7 * HOUR);
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

  it('counts a cookie without a sign-in time as signed in when first seen', async () => {
    jar.set('jmap_session', legacySessionCookie('org-alice@example.org', 'pw'));

    const first = await restore();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ serverUrl: SERVER, username: 'org-alice@example.org', password: 'pw' });
    expect(decryptSession(jar.get('jmap_session')!)?.signedInAt).toBe(NOW);

    vi.setSystemTime(NOW + 7 * HOUR);
    expect((await restore()).status).toBe(200);
    vi.setSystemTime(NOW + 8 * HOUR);
    expect((await restore()).status).toBe(401);
  });
});

describe('provider tokens (/api/auth/token)', () => {
  it('records the sign-in time when a provider sign-in stores its refresh token', async () => {
    // A leftover stamp from an earlier sign-in in this slot.
    const store = (await (await import('next/headers')).cookies()) as never;
    writeSignInStamp(store, 0, { signedInAt: NOW - 20 * HOUR, account: 'org-bob@example.org' });

    const res = await tokenRoute.POST(new NextRequest('https://webmail.example/api/auth/token?slot=0', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'c', code_verifier: 'v', redirect_uri: 'https://webmail.example/auth/callback', slot: 0 }),
    }));
    expect(res.status).toBe(200);
    expect(readSignInStamp(store, 0)).toEqual({ signedInAt: NOW });
  });

  it('refuses to renew a token sign-in older than the maximum and revokes it', async () => {
    jar.set('jmap_rt', 'refresh-1');
    const store = (await (await import('next/headers')).cookies()) as never;
    writeSignInStamp(store, 0, { signedInAt: NOW - 8 * HOUR, account: 'org-alice@example.org' });

    const res = await refresh();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_expired', maxHours: 8 });
    expect(jar.has('jmap_rt')).toBe(false);
    expect(jar.has('jmap_signed_in')).toBe(false);
    expect(tokenFetch).toHaveBeenCalledWith('https://id.example.org/revoke', expect.anything());
    expect(tokenFetch).not.toHaveBeenCalledWith('https://id.example.org/token', expect.anything());
  });

  it('renews a token sign-in younger than the maximum', async () => {
    jar.set('jmap_rt', 'refresh-1');
    const store = (await (await import('next/headers')).cookies()) as never;
    writeSignInStamp(store, 0, { signedInAt: NOW - 7 * HOUR, account: 'org-alice@example.org' });

    const res = await refresh();
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBe('new-access');
  });

  it('counts a refresh token without a sign-in time as signed in when first seen', async () => {
    jar.set('jmap_rt', 'refresh-1');

    expect((await refresh()).status).toBe(200);
    const store = (await (await import('next/headers')).cookies()) as never;
    expect(readSignInStamp(store, 0)).toEqual({ signedInAt: NOW });
  });
});

describe('the auth context (/api/auth/stalwart-context)', () => {
  const post = () => contextRoute.POST(new NextRequest('https://webmail.example/api/auth/stalwart-context', {
    method: 'POST',
    headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ serverUrl: SERVER, username: 'org-alice@example.org', authHeader: 'Bearer new', slot: 0 }),
  }));

  it('keeps the sign-in time when a renewed token is written again', async () => {
    jar.set('jmap_session', encryptSession(SERVER, 'org-alice@example.org', 'pw', NOW - 3 * HOUR));
    await restore();
    vi.setSystemTime(NOW + HOUR);

    expect((await post()).status).toBe(200);
    expect(context()?.signedInAt).toBe(NOW - 3 * HOUR);
  });

  it("takes a token sign-in's time from its stamp and names the account on it", async () => {
    const store = (await (await import('next/headers')).cookies()) as never;
    writeSignInStamp(store, 0, { signedInAt: NOW - 2 * HOUR });

    expect((await post()).status).toBe(200);
    expect(context()?.signedInAt).toBe(NOW - 2 * HOUR);
    expect(readSignInStamp(store, 0)).toEqual({ signedInAt: NOW - 2 * HOUR, account: 'org-alice@example.org' });
  });
});
