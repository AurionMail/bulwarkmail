import { beforeEach, expect, it, vi } from 'vitest';
import { createConfig } from '@/lib/__tests__/fixtures/config';

// Signing in with "Remember me" stores the session in a cookie for the next
// visit. Nothing on this visit needs it, so the login no longer waits for that
// write (it verifies the password upstream once more); signing out waits for
// it instead, so a write still running can't bring the cookie back.
vi.mock('@/lib/jmap/client', () => {
  class JMAPClient {
    constructor(public serverUrl: string, public username: string, public password: string) {}
    static withBearer() { throw new Error('not used'); }
    async connect() {}
    getSessionUsername() { return this.username; }
    getUsername() { return this.username; }
    async getIdentities() { return [{ id: 'a', email: this.username, name: this.username, mayDelete: false }]; }
    getAuthHeader() { return 'Basic eA=='; }
    onConnectionChange() {}
    onRateLimit() {}
    getRateLimitRemainingMs() { return 0; }
    supportsContacts() { return false; }
    supportsPrincipals() { return false; }
    supportsVacationResponse() { return false; }
    supportsCalendars() { return false; }
    supportsSieve() { return false; }
    disconnect() {}
    getAccountId() { return 'acct'; }
  }
  class RateLimitError extends Error {}
  return { JMAPClient, RateLimitError };
});
vi.mock('@/lib/stalwart/principal', () => ({ fetchPrincipalDisplayName: async () => null }));

import * as nav from '@/lib/browser-navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountStore } from '@/stores/account-store';

const SERVER = 'https://mail.example.com';
let releaseSessionWrite!: () => void;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  useAuthStore.setState({ isAuthenticated: false, client: null, activeAccountId: null });
  vi.spyOn(nav, 'replaceWindowLocation').mockImplementation(() => {});
  const sessionWritten = new Promise<void>((resolve) => { releaseSessionWrite = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.split('?')[0]}`);
    if (url === '/api/auth/verify') return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    if (url.startsWith('/api/auth/session') && method === 'POST') {
      await sessionWritten;
      calls.push('session written');
      return new Response('{"ok":true}', { status: 200 });
    }
    if (url.includes('/api/config')) return new Response(JSON.stringify(createConfig()), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});

it('signs in without waiting for the remembered session to be stored', async () => {
  const ok = await useAuthStore.getState().login(SERVER, 'bob@example.com', 'pw', undefined, true);
  expect(ok).toBe(true);
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(calls).toContain('POST /api/auth/session');
  expect(calls).not.toContain('session written');
  releaseSessionWrite();
});

it('signs out only after a session write still running has finished', async () => {
  await useAuthStore.getState().login(SERVER, 'bob@example.com', 'pw', undefined, true);
  const signedOut = useAuthStore.getState().logout();
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).not.toContain('DELETE /api/auth/session');
  releaseSessionWrite();
  await signedOut;
  const written = calls.indexOf('session written');
  expect(written).toBeGreaterThan(-1);
  expect(calls.indexOf('DELETE /api/auth/session')).toBeGreaterThan(written);
});
