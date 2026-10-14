import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as browserNavigation from '@/lib/browser-navigation';
import { authHooks, clearAllHooks } from '@/lib/plugin-hooks';
import { useAuthStore, LOGOUT_HOOK_BUDGET_MS } from '../auth-store';
import { useAccountStore } from '../account-store';

describe('sign-out with plugins', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllHooks();
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});
    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
    useAuthStore.setState({ isAuthenticated: true, authMode: 'basic', client: null, activeAccountId: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs out even when a plugin answers false before sign-out', async () => {
    const before = vi.fn().mockReturnValue(false);
    const after = vi.fn();
    authHooks.onBeforeLogout.register('p', before);
    authHooks.onAfterLogout.register('p', after);

    await useAuthStore.getState().logout();

    expect(before).toHaveBeenCalledWith({ accountId: 'all' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(after).toHaveBeenCalledWith({ accountId: 'all' });
  });

  it('does not wait on a plugin that never answers', async () => {
    vi.useFakeTimers();
    authHooks.onBeforeLogout.register('p', () => new Promise(() => {}));

    const done = useAuthStore.getState().logout();
    await vi.advanceTimersByTimeAsync(LOGOUT_HOOK_BUDGET_MS + 10);
    await done;

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
