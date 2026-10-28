import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverDeletedSettings } from '../recover-deleted-settings';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useRecoveryStore } from '@/stores/recovery-store';
import { toast } from '@/stores/toast-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import { parseArchivedItems, type ArchivedEmail, type RestoreResult } from '@/lib/recovery/archived-items';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { LICENSE_REFUSAL, archivedEmail } from '@/lib/recovery/__tests__/fixtures';

const config = vi.hoisted(() => ({ stalwartFeaturesEnabled: true }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => config }));

const DAY = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function items(): ArchivedEmail[] {
  const now = Date.now();
  return parseArchivedItems([
    archivedEmail('old', { subject: 'Old invoice', archivedAt: iso(now - 20 * DAY) }),
    archivedEmail('new', { subject: 'New contract', archivedAt: iso(now - 1 * DAY) }),
    archivedEmail('mid', { subject: 'Mid report', from: 'carol@example.org', archivedAt: iso(now - 5 * DAY) }),
  ]);
}

function makeClient(options: {
  query?: () => Promise<string[]>;
  list?: () => Promise<ArchivedEmail[]>;
  restore?: (ids: string[]) => RestoreResult[];
} = {}) {
  return {
    getAccountId: () => 'ci',
    advertisesArchivedItems: () => true,
    queryArchivedItemIds: vi.fn(options.query ?? (async () => ['old', 'new', 'mid'])),
    listArchivedEmails: vi.fn(options.list ?? (async () => items())),
    restoreArchivedItems: vi.fn(async (ids: string[]) => (options.restore ?? ((i: string[]) => i.map((id) => ({ id, ok: true }))))(ids)),
  };
}

const initialPolicy = usePolicyStore.getState();
const initialAuth = useAuthStore.getState();

function setPolicy(patch: { restrictions?: Record<string, object>; days?: number }) {
  usePolicyStore.setState((state) => ({
    policy: {
      ...state.policy,
      restrictions: { ...state.policy.restrictions, ...(patch.restrictions ?? {}) },
      organisation: { ...DEFAULT_ORGANISATION_POLICY, recovery: { days: patch.days ?? 0 } },
    },
  }));
}

function renderWith(client: ReturnType<typeof makeClient>) {
  useAuthStore.setState({ client: client as never, activeAccountId: 'acc-alice' });
  return render(<RecoverDeletedSettings />);
}

const rowTexts = () => screen.getAllByTestId('recover-deleted-row').map((row) => row.textContent ?? '');

beforeEach(() => {
  config.stalwartFeaturesEnabled = true;
});

afterEach(() => {
  cleanup();
  useRecoveryStore.getState().reset();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
  vi.restoreAllMocks();
});

describe('RecoverDeletedSettings', () => {
  it('shows nothing and asks nothing when the admin hides it', async () => {
    setPolicy({ restrictions: { deletedItemsRecovery: { hidden: true } } });
    const client = makeClient();
    const { container } = renderWith(client);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
    expect(client.listArchivedEmails).not.toHaveBeenCalled();
  });

  it('shows nothing when Stalwart features are switched off', async () => {
    config.stalwartFeaturesEnabled = false;
    const client = makeClient();
    const { container } = renderWith(client);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
  });

  it('shows nothing when the server refuses (no Enterprise license)', async () => {
    const client = makeClient({ query: () => Promise.reject(jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL)) });
    const { container } = renderWith(client);
    await act(async () => {});
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
    expect(client.listArchivedEmails).not.toHaveBeenCalled();
  });

  it('lists the deleted messages newest first with sender and subject', async () => {
    setPolicy({});
    renderWith(makeClient());
    await screen.findByTestId('recover-deleted-list');
    const rows = rowTexts();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('New contract');
    expect(rows[0]).toContain('Org Bob');
    expect(rows[1]).toContain('carol@example.org');
    expect(rows[2]).toContain('Old invoice');
    expect(screen.getByTestId('recover-deleted-range').textContent).toBe('range_all');
  });

  it("limits the list to the admin's days", async () => {
    setPolicy({ days: 7 });
    renderWith(makeClient());
    await screen.findByTestId('recover-deleted-list');
    expect(rowTexts().map((r) => r.includes('Old invoice'))).toEqual([false, false]);
    expect(screen.getByTestId('recover-deleted-range').textContent).toBe('range_days');
  });

  it('applies days that arrive after the list loaded', async () => {
    setPolicy({});
    renderWith(makeClient());
    await screen.findByTestId('recover-deleted-list');
    expect(rowTexts()).toHaveLength(3);
    act(() => setPolicy({ days: 2 }));
    expect(rowTexts()).toHaveLength(1);
  });

  it('says so when there is nothing to recover', async () => {
    renderWith(makeClient({ list: async () => [] }));
    expect(await screen.findByTestId('recover-deleted-empty')).toBeTruthy();
  });

  it('shows the loading state, then an error with a retry that loads again', async () => {
    let fail = true;
    const client = makeClient({ list: async () => { if (fail) throw new Error('Failed to fetch'); return items(); } });
    renderWith(client);
    expect(await screen.findByTestId('recover-deleted-loading')).toBeTruthy();
    const error = await screen.findByTestId('recover-deleted-error');
    fail = false;
    fireEvent.click(within(error).getByRole('button', { name: 'retry' }));
    await screen.findByTestId('recover-deleted-list');
    expect(client.listArchivedEmails).toHaveBeenCalledTimes(2);
  });

  it('hides itself when the license runs out while the page is open', async () => {
    const client = makeClient({ list: () => Promise.reject(jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL)) });
    const { container } = renderWith(client);
    await waitFor(() => expect(client.listArchivedEmails).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('restores the selected messages and takes them off the list', async () => {
    const success = vi.spyOn(toast, 'success');
    const client = makeClient();
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    const restore = screen.getByTestId('recover-deleted-restore') as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    const rows = screen.getAllByTestId('recover-deleted-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(within(rows[2]).getByRole('checkbox'));
    fireEvent.click(restore);
    await waitFor(() => expect(client.restoreArchivedItems).toHaveBeenCalledWith(['new', 'old']));
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(rowTexts()[0]).toContain('Mid report');
    expect(success).toHaveBeenCalledWith('restored');
  });

  it('keeps the ones that failed selected and says how many', async () => {
    const error = vi.spyOn(toast, 'error');
    const client = makeClient({ restore: (ids) => ids.map((id) => (id === 'mid' ? { id, ok: false, error: 'notFound' } : { id, ok: true })) });
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    fireEvent.click(screen.getByTestId('recover-deleted-select-all'));
    fireEvent.click(screen.getByTestId('recover-deleted-restore'));
    await screen.findByTestId('recover-deleted-partial');
    expect(error).toHaveBeenCalledWith('restore_partial');
    const rows = screen.getAllByTestId('recover-deleted-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Mid report');
    expect((within(rows[0]).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
