import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// The driver syncs the active account's templates when its synced settings
// have loaded, also when the load changed nothing in the browser's list:
// only then is it known whose that list is.

const sync = vi.hoisted(() => ({ schedule: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/templates/personal-templates', () => ({
  scheduleAccountSync: sync.schedule,
  refreshAccountTemplates: sync.refresh,
}));
vi.mock('@/lib/templates/team-templates', () => ({ refreshTeamTemplates: vi.fn() }));
vi.mock('@/lib/browser-navigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ settings: { theme: 'dark' } }), { status: 200 })),
}));

import { AccountTemplateSync } from '../account-template-sync';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

const ACCOUNT = 'carol@example.org@mail.example.com';
const original = useAuthStore.getState();

beforeEach(() => {
  sync.schedule.mockClear();
  localStorage.removeItem('settings-sync-owner');
  useAuthStore.setState({ isAuthenticated: true, activeAccountId: ACCOUNT, client: {} as never });
});
afterEach(() => {
  useAuthStore.setState({ isAuthenticated: original.isAuthenticated, activeAccountId: original.activeAccountId, client: original.client });
});

describe('AccountTemplateSync', () => {
  it('syncs the active account once its settings have loaded', async () => {
    render(<AccountTemplateSync />);
    expect(sync.schedule).not.toHaveBeenCalled();
    await useSettingsStore.getState().loadFromServer('carol@example.org', 'https://mail.example.com');
    expect(sync.schedule).toHaveBeenCalledWith(ACCOUNT);
  });

  it('leaves another account\'s settings load alone', async () => {
    render(<AccountTemplateSync />);
    await useSettingsStore.getState().loadFromServer('dave@example.org', 'https://mail.example.com');
    expect(sync.schedule).not.toHaveBeenCalled();
  });
});
