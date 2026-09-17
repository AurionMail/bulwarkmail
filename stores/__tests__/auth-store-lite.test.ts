import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bulwark Lite (static export) has no /api/* routes: sessions are kept in web
// storage and renewed against the mail server directly. These tests run the
// auth store with IS_LITE forced on and assert that nothing under /api/ on
// our own origin is ever called (config.json / policy.json are static files).
vi.mock('@/lib/lite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lite')>()),
  IS_LITE: true,
}));

import { JMAPClient } from '@/lib/jmap/client';
import * as browserNavigation from '@/lib/browser-navigation';
import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';
import { readLiteRefreshToken, readLiteBasicSession, saveLiteRefreshToken, saveLiteBasicSession } from '@/lib/auth/lite-tokens';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const SERVER = 'https://mail.example.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A fetch that serves Stalwart's login + token endpoints, the static
 * config/policy files, and fails on anything else - in particular on any
 * /api/ route of our own origin. `calls` lists the mail-server requests.
 */
function stalwartFetch(options: { loginAnswer?: unknown; refreshAnswer?: () => Response; loginStatus?: number } = {}) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = String(input);
    if (url === '/config.json') return jsonResponse({ jmapServerUrl: SERVER });
    if (url === '/policy.json') return jsonResponse({});
    if (url.startsWith('/')) throw new Error(`Lite must not call its own origin: ${url}`);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === `${SERVER}/api/auth`) {
      if (options.loginStatus) return new Response('nope', { status: options.loginStatus });
      return jsonResponse(options.loginAnswer ?? { type: 'authenticated', client_code: 'CODE' });
    }
    if (url === `${SERVER}/auth/token`) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get('grant_type') === 'refresh_token') {
        return options.refreshAnswer ? options.refreshAnswer() : jsonResponse({ access_token: 'AT-refreshed', expires_in: 3600, refresh_token: 'RT-2' });
      }
      return jsonResponse({ access_token: 'AT-1', expires_in: 3600, refresh_token: 'RT-1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

function liteStorageKeys(): string[] {
  return [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('bulwark-lite:'));
}

function registerAccount(authMode: 'basic' | 'oauth'): string {
  return useAccountStore.getState().addAccount({
    label: 'alice',
    serverUrl: SERVER,
    username: 'alice',
    authMode,
    rememberMe: true,
    displayName: 'alice',
    email: 'alice@example.com',
    lastLoginAt: Date.now(),
    isConnected: false,
    hasError: false,
    isDefault: true,
  });
}

describe('auth-store in the static Lite build', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    window.history.pushState({}, '', '/en/login');

    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      error: null,
      serverUrl: null,
      username: null,
      client: null,
      identities: [],
      primaryIdentity: null,
      authMode: 'basic',
      rememberMe: false,
      accessToken: null,
      tokenExpiresAt: null,
      connectionLost: false,
      activeAccountId: null,
      isDemoMode: false,
    });

    connectSpy = vi.spyOn(JMAPClient.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(JMAPClient.prototype, 'getIdentities').mockResolvedValue([]);
    vi.spyOn(JMAPClient.prototype, 'getSessionUsername').mockReturnValue('alice@example.com');
    vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [id] of useAuthStore.getState().getAllConnectedClients()) {
      useAuthStore.getState().removeAccount(id);
    }
  });

  it('"remember me" logs in through Stalwart token login and keeps only a refresh token in localStorage', async () => {
    const { calls } = stalwartFetch();

    const ok = await useAuthStore.getState().login(SERVER, 'alice', 'pw', undefined, true);

    expect(ok).toBe(true);
    expect(calls).toEqual([`POST ${SERVER}/api/auth`, `POST ${SERVER}/auth/token`]);
    const state = useAuthStore.getState();
    expect(state.authMode).toBe('oauth');
    expect(state.accessToken).toBe('AT-1');
    expect(state.client?.getAuthHeader()).toBe('Bearer AT-1');
    expect(readLiteRefreshToken(0)).toEqual({ serverUrl: SERVER, username: 'alice', refreshToken: 'RT-1' });
    expect(localStorage.getItem('bulwark-lite:refresh:0')).not.toBeNull();
    // No password anywhere in web storage.
    const dump = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(dump).not.toContain('"pw"');
    expect(readLiteBasicSession(0)).toBeNull();
  });

  it('a TOTP login without "remember me" keeps the refresh token with the tab only', async () => {
    const { mock } = stalwartFetch();

    const ok = await useAuthStore.getState().login(SERVER, 'alice', 'pw', '123456', false);

    expect(ok).toBe(true);
    const loginCall = mock.mock.calls.find(([input]) => String(input) === `${SERVER}/api/auth`);
    expect(JSON.parse(String(loginCall?.[1]?.body)).mfaToken).toBe('123456');
    expect(localStorage.getItem('bulwark-lite:refresh:0')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('bulwark-lite:refresh:0')!).refreshToken).toBe('RT-1');
  });

  it('a plain password login without "remember me" connects with Basic auth and stores nothing', async () => {
    const { calls } = stalwartFetch();

    const ok = await useAuthStore.getState().login(SERVER, 'alice', 'pw');

    expect(ok).toBe(true);
    expect(calls).toEqual([]);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().authMode).toBe('basic');
    expect(useAuthStore.getState().client?.getAuthHeader()).toBe(`Basic ${btoa('alice:pw')}`);
    expect(liteStorageKeys()).toEqual([]);
  });

  it('surfaces a missing MFA code as totp_required', async () => {
    stalwartFetch({ loginAnswer: { type: 'mfaRequired' } });

    const ok = await useAuthStore.getState().login(SERVER, 'alice', 'pw', undefined, true);

    expect(ok).toBe(false);
    expect(useAuthStore.getState().error).toBe('totp_required');
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('falls back to Basic auth with a tab-scoped session when the server has no token login', async () => {
    const { calls } = stalwartFetch({ loginStatus: 404 });

    const ok = await useAuthStore.getState().login(SERVER, 'alice', 'pw', undefined, true);

    expect(ok).toBe(true);
    expect(calls).toEqual([`POST ${SERVER}/api/auth`]);
    expect(useAuthStore.getState().authMode).toBe('basic');
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(readLiteRefreshToken(0)).toBeNull();
    expect(readLiteBasicSession(0)).toEqual({ serverUrl: SERVER, username: 'alice', password: 'pw' });
    expect(localStorage.getItem('bulwark-lite:basic:0')).toBeNull();
  });

  it('restores a remembered token session on reload by refreshing against the mail server', async () => {
    saveLiteRefreshToken(0, { serverUrl: SERVER, username: 'alice', refreshToken: 'RT-1' }, true);
    registerAccount('oauth');
    const { calls } = stalwartFetch();

    await useAuthStore.getState().checkAuth();

    expect(calls).toEqual([`POST ${SERVER}/auth/token`]);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.client?.getAuthHeader()).toBe('Bearer AT-refreshed');
    expect(readLiteRefreshToken(0)?.refreshToken).toBe('RT-2');
  });

  it('restores a tab-scoped Basic session from sessionStorage', async () => {
    saveLiteBasicSession(0, { serverUrl: SERVER, username: 'alice', password: 'pw' });
    registerAccount('basic');
    const { calls } = stalwartFetch();

    await useAuthStore.getState().checkAuth();

    expect(calls).toEqual([]);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().client?.getAuthHeader()).toBe(`Basic ${btoa('alice:pw')}`);
  });

  it('evicts an account whose refresh token the server rejected', async () => {
    saveLiteRefreshToken(0, { serverUrl: SERVER, username: 'alice', refreshToken: 'RT-dead' }, true);
    const id = registerAccount('oauth');
    stalwartFetch({ refreshAnswer: () => jsonResponse({ error: 'invalid_grant' }, 400) });

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAccountStore.getState().getAccountById(id)).toBeUndefined();
    expect(readLiteRefreshToken(0)).toBeNull();
  });

  it('keeps the account when the mail server is unreachable during restore', async () => {
    saveLiteRefreshToken(0, { serverUrl: SERVER, username: 'alice', refreshToken: 'RT-1' }, true);
    const id = registerAccount('oauth');
    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput) => {
      if (String(input) === '/config.json' || String(input) === '/policy.json') return jsonResponse({});
      throw new TypeError('Failed to fetch');
    }));

    await useAuthStore.getState().checkAuth();

    expect(useAccountStore.getState().getAccountById(id)?.hasError).toBe(true);
    expect(readLiteRefreshToken(0)?.refreshToken).toBe('RT-1');
  });

  it('logout wipes the slot from web storage without touching our origin', async () => {
    const { calls } = stalwartFetch();
    await useAuthStore.getState().login(SERVER, 'alice', 'pw', undefined, true);
    expect(readLiteRefreshToken(0)).not.toBeNull();
    calls.length = 0;

    await useAuthStore.getState().logout();

    expect(calls).toEqual([]);
    expect(readLiteRefreshToken(0)).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('logoutAll clears every Lite slot', async () => {
    saveLiteRefreshToken(0, { serverUrl: SERVER, username: 'a', refreshToken: 'r0' }, true);
    saveLiteRefreshToken(1, { serverUrl: SERVER, username: 'b', refreshToken: 'r1' }, false);
    saveLiteBasicSession(2, { serverUrl: SERVER, username: 'c', password: 'p' });
    const { calls } = stalwartFetch();

    await useAuthStore.getState().logoutAll();

    expect(calls).toEqual([]);
    expect(liteStorageKeys()).toEqual([]);
  });

  it('refreshAccessToken renews through the mail server and signs out on a definitive rejection', async () => {
    const { calls } = stalwartFetch();
    await useAuthStore.getState().login(SERVER, 'alice', 'pw', undefined, true);
    calls.length = 0;

    const token = await useAuthStore.getState().refreshAccessToken();
    expect(token).toBe('AT-refreshed');
    expect(calls).toEqual([`POST ${SERVER}/auth/token`]);
    expect(useAuthStore.getState().accessToken).toBe('AT-refreshed');

    stalwartFetch({ refreshAnswer: () => jsonResponse({ error: 'invalid_grant' }, 400) });
    const rejected = await useAuthStore.getState().refreshAccessToken();
    expect(rejected).toBeNull();
    // logout() runs asynchronously after the 401.
    await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
    expect(readLiteRefreshToken(0)).toBeNull();
  });
});
