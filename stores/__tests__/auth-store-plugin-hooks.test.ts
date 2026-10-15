import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHooks, clearAllHooks } from '@/lib/plugin-hooks';
import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';

function listen(bus: { register: (id: string, fn: (...a: unknown[]) => unknown) => unknown }) {
  const fn = vi.fn();
  bus.register('test', fn);
  return fn;
}

const ACCOUNT = {
  label: 'Alice', serverUrl: 'https://mail.example.org', username: 'alice@example.org', authMode: 'basic' as const,
  rememberMe: false, displayName: 'Alice', email: 'alice@example.org', lastLoginAt: 0,
  isConnected: true, hasError: false, isDefault: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
  clearAllHooks();
  useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  useAuthStore.setState({ isAuthenticated: false, client: null, activeAccountId: null, username: null });
});

describe('auth hooks', () => {
  it('reports accounts that are added and removed, once each', () => {
    const added = listen(authHooks.onAccountAdd);
    const removed = listen(authHooks.onAccountRemove);

    const id = useAccountStore.getState().addAccount(ACCOUNT);
    useAccountStore.getState().addAccount(ACCOUNT); // already there: an update
    useAccountStore.getState().removeAccount(id);
    useAccountStore.getState().removeAccount(id); // already gone

    expect(added.mock.calls).toEqual([[{ accountId: id }]]);
    expect(removed.mock.calls).toEqual([[{ accountId: id }]]);
  });

  it('says when the session is ready, and when another account becomes active', () => {
    const ready = listen(authHooks.onAuthReady);
    const switched = listen(authHooks.onAccountSwitch);
    const client = {} as never;

    useAuthStore.setState({ isAuthenticated: true, client, activeAccountId: 'a' });
    useAuthStore.setState({ activeAccountId: 'b' });

    expect(ready.mock.calls).toEqual([[{ accountId: 'a' }]]);
    expect(switched).toHaveBeenCalledWith({ accountId: 'b', previousAccountId: 'a' });
  });

  it('reports a renewed access token', async () => {
    const refreshed = listen(authHooks.onTokenRefresh);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ access_token: 'new', expires_in: 3600 }),
    })));
    useAuthStore.setState({ activeAccountId: 'acc', authMode: 'oauth' });

    await expect(useAuthStore.getState().refreshAccessToken()).resolves.toBe('new');

    expect(refreshed).toHaveBeenCalledWith({ accountId: 'acc' });
  });

  it('reports a sign-in', async () => {
    const signedIn = listen(authHooks.onLogin);

    const ok = await useAuthStore.getState().loginDemo();

    expect(ok).toBe(true);
    const { activeAccountId, username } = useAuthStore.getState();
    expect(signedIn).toHaveBeenCalledWith({ accountId: activeAccountId, username });
  });
});
