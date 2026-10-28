import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverDeletedSettings } from '../recover-deleted-settings';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useRecoveryStore } from '@/stores/recovery-store';
import { toast } from '@/stores/toast-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import { parseArchivedItems, type ArchiveListResult, type ArchivedEmail, type RestoreResult } from '@/lib/recovery/archived-items';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { ACCOUNT, LICENSE_REFUSAL, archivedEmail } from '@/lib/recovery/__tests__/fixtures';

const config = vi.hoisted(() => ({ stalwartFeaturesEnabled: true, isLoading: false }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => config }));

const DAY = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ALICE = 'org-alice@example.org';
const BOB = 'org-bob@example.org';

function items(prefix = ''): ArchivedEmail[] {
  const now = Date.now();
  return parseArchivedItems([
    archivedEmail(`${prefix}old`, { subject: `${prefix}Old invoice`, archivedAt: iso(now - 20 * DAY), archivedUntil: iso(now + DAY) }),
    archivedEmail(`${prefix}new`, { subject: `${prefix}New contract`, archivedAt: iso(now - 1 * DAY), archivedUntil: iso(now + DAY) }),
    archivedEmail(`${prefix}mid`, { subject: `${prefix}Mid report`, from: 'carol@example.org', archivedAt: iso(now - 5 * DAY), archivedUntil: iso(now + DAY) }),
  ], ACCOUNT);
}

const page = (list: ArchivedEmail[], nextPosition: number | null = null): ArchiveListResult => ({ items: list, nextPosition });

function makeClient(options: {
  email?: string;
  accountId?: string;
  query?: () => Promise<{ ids: string[]; total: number | null }>;
  list?: (opts?: { days?: number; startPosition?: number }) => Promise<ArchiveListResult>;
  restore?: (ids: string[]) => RestoreResult[] | Promise<RestoreResult[]>;
} = {}) {
  return {
    getAccountId: () => options.accountId ?? ACCOUNT,
    getUsername: () => options.email ?? ALICE,
    advertisesArchivedItems: () => true,
    queryArchivedItemIds: vi.fn(options.query ?? (async () => ({ ids: ['x'], total: null }))),
    listArchivedEmails: vi.fn(async (_account?: string, opts?: { days?: number; startPosition?: number }) => (options.list ?? (async () => page(items())))(opts)),
    restoreArchivedItems: vi.fn(async (ids: string[]) => (options.restore ?? ((i: string[]) => i.map((id) => ({ id, ok: true }))))(ids)),
    hasArchivedEmail: vi.fn(async () => true),
  };
}

const initialPolicy = usePolicyStore.getState();
const initialAuth = useAuthStore.getState();

function setPolicy(patch: { restrictions?: Record<string, object>; days?: number; subject?: string | null; loaded?: boolean }) {
  usePolicyStore.setState((state) => {
    const policy = {
      ...state.policy,
      restrictions: { ...initialPolicy.policy.restrictions, ...(patch.restrictions ?? {}) },
      organisation: { ...DEFAULT_ORGANISATION_POLICY, recovery: { days: patch.days ?? 0 } },
    };
    // rawPolicy too: the store re-resolves from it whenever the subject changes.
    return {
      loaded: patch.loaded ?? true,
      subject: patch.subject === null ? null : { email: patch.subject ?? ALICE, groups: [] },
      rawPolicy: policy,
      policy,
    };
  });
}

function renderWith(client: ReturnType<typeof makeClient>, activeAccountId = 'acc-alice') {
  const subject = usePolicyStore.getState().subject;
  useAuthStore.setState({ client: client as never, activeAccountId });
  // The auth store clears the subject while nobody is signed in; the test's policy stands.
  usePolicyStore.setState({ subject });
  return render(<RecoverDeletedSettings />);
}

function switchTo(client: ReturnType<typeof makeClient>, activeAccountId: string, email: string) {
  act(() => {
    useAuthStore.setState({ client: client as never, activeAccountId });
    usePolicyStore.setState({ subject: { email, groups: [] } });
  });
}

const rowTexts = () => screen.getAllByTestId('recover-deleted-row').map((row) => row.textContent ?? '');

beforeEach(() => {
  config.stalwartFeaturesEnabled = true;
  config.isLoading = false;
  setPolicy({});
});

afterEach(() => {
  cleanup();
  useRecoveryStore.getState().reset();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
  vi.restoreAllMocks();
});

describe('RecoverDeletedSettings: when it asks', () => {
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

  it('waits for the policy and the config before asking', async () => {
    setPolicy({ loaded: false });
    config.isLoading = true;
    const client = makeClient();
    const view = renderWith(client);
    await act(async () => {});
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
    config.isLoading = false;
    act(() => setPolicy({ loaded: true }));
    view.rerender(<RecoverDeletedSettings />);
    await screen.findByTestId('recover-deleted-list');
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it("waits until the policy is the new account's, and then follows its restrictions only", async () => {
    // alice's policy shows it; bob's account hides it.
    const alice = makeClient();
    renderWith(alice);
    await screen.findByTestId('recover-deleted-list');
    const bob = makeClient({ email: BOB, accountId: 'cj' });
    // The client switched, the policy is still alice's: nothing is asked for bob.
    act(() => useAuthStore.setState({ client: bob as never, activeAccountId: 'acc-bob' }));
    await act(async () => {});
    expect(bob.queryArchivedItemIds).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recover-deleted-list')).toBeNull();
    act(() => setPolicy({ subject: BOB, restrictions: { deletedItemsRecovery: { hidden: true } } }));
    await act(async () => {});
    expect(bob.queryArchivedItemIds).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recover-deleted-list')).toBeNull();
  });

  it('shows nothing when the server refuses (no Enterprise license)', async () => {
    const client = makeClient({ query: () => Promise.reject(jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL)) });
    const { container } = renderWith(client);
    await act(async () => {});
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
    expect(client.listArchivedEmails).not.toHaveBeenCalled();
  });
});

describe('RecoverDeletedSettings: the list', () => {
  it('lists the deleted messages newest first with sender and subject', async () => {
    const client = makeClient();
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    const rows = rowTexts();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('New contract');
    expect(rows[0]).toContain('Org Bob');
    expect(rows[1]).toContain('carol@example.org');
    expect(rows[2]).toContain('Old invoice');
    expect(screen.getByTestId('recover-deleted-range').textContent).toBe('range_all');
    expect(client.listArchivedEmails).toHaveBeenCalledWith(undefined, { days: 0 });
  });

  it("asks the server for the admin's days and filters by them", async () => {
    setPolicy({ days: 7 });
    const client = makeClient();
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    expect(client.listArchivedEmails).toHaveBeenCalledWith(undefined, { days: 7 });
    expect(rowTexts().map((r) => r.includes('Old invoice'))).toEqual([false, false]);
    expect(screen.getByTestId('recover-deleted-range').textContent).toBe('range_days');
  });

  it('loads again with days that arrive later', async () => {
    const client = makeClient();
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    expect(rowTexts()).toHaveLength(3);
    act(() => setPolicy({ days: 2 }));
    await waitFor(() => expect(client.listArchivedEmails).toHaveBeenLastCalledWith(undefined, { days: 2 }));
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
  });

  it('says when archiving has to be on for anything to show', async () => {
    renderWith(makeClient({ list: async () => page([]) }));
    const empty = await screen.findByTestId('recover-deleted-empty');
    expect(empty.textContent).toContain('empty');
    expect(empty.textContent).toContain('empty_hint');
  });

  it('shows the loading state, then an error with a retry that loads again', async () => {
    let fail = true;
    const client = makeClient({ list: async () => { if (fail) throw new Error('Failed to fetch'); return page(items()); } });
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

  it('offers Show older past the first 2000 and adds what it finds', async () => {
    const older = parseArchivedItems([archivedEmail('ancient', { subject: 'Ancient memo', archivedAt: iso(Date.now() - 2 * DAY), archivedUntil: iso(Date.now() + DAY) })], ACCOUNT);
    const client = makeClient({ list: async (opts) => (opts?.startPosition ? page(older) : page(items(), 2000)) });
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    fireEvent.click(screen.getByTestId('recover-deleted-show-older'));
    await waitFor(() => expect(rowTexts()).toHaveLength(4));
    expect(client.listArchivedEmails).toHaveBeenLastCalledWith(undefined, { days: 0, startPosition: 2000 });
    expect(rowTexts().some((r) => r.includes('Ancient memo'))).toBe(true);
    expect(screen.queryByTestId('recover-deleted-show-older')).toBeNull();
  });

  it('the select-all checkbox is named by the text next to it', async () => {
    renderWith(makeClient());
    await screen.findByTestId('recover-deleted-list');
    expect(screen.getByRole('checkbox', { name: 'select_all' })).toBe(screen.getByTestId('recover-deleted-select-all'));
    fireEvent.click(screen.getByTestId('recover-deleted-select-all'));
    expect(screen.getByRole('checkbox', { name: 'selected' })).toBe(screen.getByTestId('recover-deleted-select-all'));
  });
});

describe('RecoverDeletedSettings: restoring', () => {
  it('restores the selected messages, takes them off the list and keeps focus on the button', async () => {
    const success = vi.spyOn(toast, 'success');
    const client = makeClient();
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    const restore = screen.getByTestId('recover-deleted-restore');
    expect(restore.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(restore);
    expect(client.restoreArchivedItems).not.toHaveBeenCalled();
    const rows = screen.getAllByTestId('recover-deleted-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(within(rows[2]).getByRole('checkbox'));
    restore.focus();
    fireEvent.click(restore);
    await waitFor(() => expect(client.restoreArchivedItems).toHaveBeenCalledWith(['new', 'old']));
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(rowTexts()[0]).toContain('Mid report');
    expect(success).toHaveBeenCalledWith('restored');
    expect(document.activeElement).toBe(screen.getByTestId('recover-deleted-restore'));
    expect(screen.getByTestId('recover-deleted-restore').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('recover-deleted-status').textContent).toContain('restored');
  });

  it('keeps the ones that failed selected and says how many, until the list loads again', async () => {
    const error = vi.spyOn(toast, 'error');
    const client = makeClient({ restore: (ids) => ids.map((id) => (id === 'mid' ? { id, ok: false, error: 'serverFail', type: 'serverFail' } : { id, ok: true })) });
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
    // Refresh: a new list, without the old failure note.
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(client.listArchivedEmails).toHaveBeenCalledTimes(2));
    await screen.findByTestId('recover-deleted-list');
    expect(screen.queryByTestId('recover-deleted-partial')).toBeNull();
  });

  it('takes items the archive no longer has off the list with a note, not as failures', async () => {
    const error = vi.spyOn(toast, 'error');
    const client = makeClient({ restore: (ids) => ids.map((id) => (id === 'mid' ? { id, ok: false, error: 'notFound', type: 'notFound' } : { id, ok: true })) });
    renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    fireEvent.click(screen.getByTestId('recover-deleted-select-all'));
    fireEvent.click(screen.getByTestId('recover-deleted-restore'));
    await waitFor(() => expect(screen.getByTestId('recover-deleted-status').textContent).toContain('restore_gone'));
    expect(screen.queryByTestId('recover-deleted-partial')).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByTestId('recover-deleted-empty')).toBeTruthy();
  });

  it('hides the page when the restore is refused for the license', async () => {
    const client = makeClient({ restore: (ids) => ids.map((id) => ({ id, ok: false, error: LICENSE_REFUSAL.description, type: 'forbidden' })) });
    const { container } = renderWith(client);
    await screen.findByTestId('recover-deleted-list');
    fireEvent.click(screen.getByTestId('recover-deleted-select-all'));
    fireEvent.click(screen.getByTestId('recover-deleted-restore'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(useRecoveryStore.getState().checks['acc-alice|ci']?.supported).toBe(false);
  });
});

describe('RecoverDeletedSettings: switching accounts', () => {
  it("never shows a list that arrives after the switch for the other account", async () => {
    let finishAlice: (r: ArchiveListResult) => void = () => {};
    const alice = makeClient({ list: () => new Promise((resolve) => { finishAlice = resolve; }) });
    renderWith(alice);
    await waitFor(() => expect(alice.listArchivedEmails).toHaveBeenCalled());
    const bob = makeClient({ email: BOB, accountId: 'cj', list: async () => page(items('bob-')) });
    switchTo(bob, 'acc-bob', BOB);
    await screen.findByTestId('recover-deleted-list');
    await act(async () => finishAlice(page(items('alice-'))));
    expect(rowTexts()).toHaveLength(3);
    expect(rowTexts().every((r) => r.includes('bob-'))).toBe(true);
  });

  it("doesn't apply a restore that finishes after the switch to the other account's list", async () => {
    const success = vi.spyOn(toast, 'success');
    let finishRestore: (r: RestoreResult[]) => void = () => {};
    const alice = makeClient({ list: async () => page(items()), restore: () => new Promise((resolve) => { finishRestore = resolve; }) });
    renderWith(alice);
    await screen.findByTestId('recover-deleted-list');
    fireEvent.click(screen.getByTestId('recover-deleted-select-all'));
    fireEvent.click(screen.getByTestId('recover-deleted-restore'));
    await waitFor(() => expect(alice.restoreArchivedItems).toHaveBeenCalled());
    // bob's archive has the same ids.
    const bob = makeClient({ email: BOB, accountId: 'cj', list: async () => page(items()) });
    switchTo(bob, 'acc-bob', BOB);
    await waitFor(() => expect(bob.listArchivedEmails).toHaveBeenCalled());
    await screen.findByTestId('recover-deleted-list');
    await act(async () => finishRestore(['new', 'mid', 'old'].map((id) => ({ id, ok: true }))));
    expect(rowTexts()).toHaveLength(3);
    expect(success).not.toHaveBeenCalled();
    expect((screen.getByTestId('recover-deleted-select-all') as HTMLInputElement).checked).toBe(false);
  });
});
