import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createConfig } from '@/lib/__tests__/fixtures/config';

// Without "Remember me" nothing is stored to resume from, so a reload signs
// the user out on purpose. The login page then said "Your session has
// expired", which reads like an error.
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
  class RequestTimeoutError extends Error {}
  return { JMAPClient, RateLimitError, RequestTimeoutError };
});
vi.mock('@/lib/stalwart/principal', () => ({ fetchPrincipalDisplayName: async () => null }));

import * as nav from '@/lib/browser-navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountStore } from '@/stores/account-store';

const signedIn = {
  id: 'bob@x.test@mail.x.test', label: 'Bob', serverUrl: 'https://mail.x.test', username: 'bob@x.test', authMode: 'basic' as const,
  rememberMe: true, cookieSlot: 0, displayName: 'Bob', email: 'bob@x.test', isConnected: false, hasError: false,
  lastLoginAt: 1, avatarColor: '#000000', isDefault: true,
};
const redirect = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/config')) return new Response(JSON.stringify(createConfig()), { status: 200 });
    return new Response('{}', { status: 401 });
  }));
  vi.spyOn(nav, 'replaceWindowLocation').mockImplementation(redirect);
});

beforeEach(() => {
  redirect.mockClear();
  sessionStorage.clear();
});

it('does not call a reload of a session without Remember me an expired session', async () => {
  useAccountStore.setState({ accounts: [{ ...signedIn, rememberMe: false }] as never, activeAccountId: signedIn.id, defaultAccountId: signedIn.id });

  await useAuthStore.getState().checkAuth();

  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(sessionStorage.getItem('session_expired')).toBeNull();
});

it('still reports a remembered session that could not be resumed', async () => {
  useAccountStore.setState({ accounts: [signedIn] as never, activeAccountId: signedIn.id, defaultAccountId: signedIn.id });

  await useAuthStore.getState().checkAuth();

  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(sessionStorage.getItem('session_expired')).toBe('true');
});
