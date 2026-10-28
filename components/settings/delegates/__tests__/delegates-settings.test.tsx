import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelegatesSettings } from '../delegates-settings';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import type { ShareChange, ShareChangeResult, ShareTarget } from '@/lib/jmap/share-batch';
import { CALENDAR_PRESETS, FILE_PRESETS, MAILBOX_PRESETS } from '@/lib/jmap/share-rights';
import type { Principal, PrincipalListing } from '@/lib/jmap/types';

const ALICE: Principal = { id: 'ci', type: 'individual', name: 'org-alice@example.org', email: 'org-alice@example.org' };
const TEAM: Principal = { id: 'ch', type: 'group', name: 'org-team@example.org', email: 'org-team@example.org' };
const CAROL: Principal = { id: 'ck', type: 'individual', name: 'org-carol@example.org', email: 'org-carol@example.org' };

// Stalwart 1.0 with directory queries off: only the principals alice knows.
const DIRECTORY_OFF: PrincipalListing = { principals: [ALICE, TEAM, CAROL], status: 'restricted', directoryQueriesOff: true };

function targets(withCarol = false): ShareTarget[] {
  const carol = (rights: object) => (withCarol ? { ck: rights } : {});
  return [
    { kind: 'mailbox', accountId: 'ci', id: 'a', name: 'Inbox', role: 'inbox', shareWith: carol({ ...MAILBOX_PRESETS.read, maySetKeywords: true }) as never },
    { kind: 'mailbox', accountId: 'ci', id: 'b', name: 'Sent Items', role: 'sent', shareWith: {} },
    { kind: 'calendar', accountId: 'ci', id: 'c', name: 'Calendar', isDefault: true, shareWith: carol(CALENDAR_PRESETS.read) as never },
    { kind: 'addressBook', accountId: 'ci', id: 'd', name: 'Contacts', isDefault: true, shareWith: {} },
    ...(withCarol ? [{ kind: 'file' as const, accountId: 'ci', id: 'n', name: 'plan.pdf', shareWith: { ck: FILE_PRESETS.read } }] : []),
  ];
}

const ok = (changes: ShareChange[]): ShareChangeResult[] => changes.map((change) => ({ change, ok: true }));

function makeClient(options: { withCarol?: boolean; directory?: PrincipalListing; apply?: (c: ShareChange[]) => ShareChangeResult[] } = {}) {
  return {
    getAccountId: () => 'ci',
    supportsPrincipals: () => true,
    getPrincipals: vi.fn(async () => (options.directory ?? DIRECTORY_OFF).principals),
    listPrincipals: vi.fn(async () => options.directory ?? DIRECTORY_OFF),
    getShareTargets: vi.fn(async () => ({ targets: targets(options.withCarol), failed: [] })),
    applyShareChanges: vi.fn(async (changes: ShareChange[]) => (options.apply ?? ok)(changes)),
    findPrincipalByEmail: vi.fn(async () => ({ principal: null, status: 'forbidden' as const, directoryQueriesOff: true })),
  };
}

const initialPolicy = usePolicyStore.getState();
const initialAuth = useAuthStore.getState();

function restrict(restrictions: Record<string, object>) {
  usePolicyStore.setState((state) => ({ policy: { ...state.policy, restrictions: { ...state.policy.restrictions, ...restrictions } } }));
}

function renderWith(client: ReturnType<typeof makeClient>) {
  useAuthStore.setState({ client: client as never, activeAccountId: 'acc-alice' });
  return render(<DelegatesSettings />);
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
});

describe('DelegatesSettings', () => {
  it('shows nothing and reads nothing when the admin hides delegation', async () => {
    restrict({ delegation: { hidden: true } });
    const client = makeClient();
    const { container } = renderWith(client);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(client.getShareTargets).not.toHaveBeenCalled();
  });

  it('appears once a late policy stops hiding it', async () => {
    restrict({ delegation: { hidden: true } });
    const client = makeClient();
    renderWith(client);
    await act(async () => {});
    act(() => usePolicyStore.setState((state) => ({ policy: { ...state.policy, restrictions: {} } })));
    expect(await screen.findByText('give_access')).toBeInTheDocument();
    expect(client.getShareTargets).toHaveBeenCalled();
  });

  it('lists everyone with access, grouped by person, with what they have', async () => {
    renderWith(makeClient({ withCarol: true }));
    const row = await screen.findByTestId('delegate-row');
    expect(within(row).getByText('org-carol@example.org')).toBeInTheDocument();
    expect(within(row).getByText('summary.mail_inbox · summary.calendars · summary.files · level.read')).toBeInTheDocument();
    expect(screen.getAllByTestId('delegate-row')).toHaveLength(1);
  });

  it('removes a person from every item, files included', async () => {
    const client = makeClient({ withCarol: true });
    renderWith(client);
    const row = await screen.findByTestId('delegate-row');
    fireEvent.click(within(row).getByRole('button', { name: 'remove' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'remove' }));
    await waitFor(() => expect(client.applyShareChanges).toHaveBeenCalledTimes(1));
    const changes = client.applyShareChanges.mock.calls[0][0];
    expect(changes.map((c) => [c.kind, c.id, c.principalId, c.rights])).toEqual([
      ['mailbox', 'a', 'ck', null],
      ['calendar', 'c', 'ck', null],
      ['file', 'n', 'ck', null],
    ]);
    // The overview is read again afterwards.
    await waitFor(() => expect(client.getShareTargets).toHaveBeenCalledTimes(2));
  });
});

describe('DelegateDialog', () => {
  async function openDialog(client: ReturnType<typeof makeClient>) {
    renderWith(client);
    fireEvent.click(await screen.findByText('give_access'));
    return screen.findByRole('dialog');
  }

  it('says why only known people are listed when directory queries are off', async () => {
    const dialog = await openDialog(makeClient());
    expect(within(dialog).getByTestId('delegate-directory-off')).toHaveTextContent('directory_off_note');
    // The user's own principal isn't offered; their group and carol are.
    const options = within(dialog).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.includes('org-alice'))).toBe(false);
    expect(options.some((o) => o?.includes('org-carol'))).toBe(true);
  });

  it('shows the note for a typed address the server cannot look up', async () => {
    const client = makeClient({ directory: { principals: [ALICE], status: 'restricted', directoryQueriesOff: true } });
    const dialog = await openDialog(client);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'org-carol@example.org' } });
    fireEvent.click(within(dialog).getByText('use_address'));
    await waitFor(() => expect(client.findPrincipalByEmail).toHaveBeenCalledWith('org-carol@example.org'));
    expect(within(dialog).getByTestId('delegate-directory-off')).toHaveTextContent('directory_off_note');
  });

  it('takes a typed address the server resolves', async () => {
    const client = makeClient({ directory: { principals: [ALICE], status: 'ok' } });
    client.findPrincipalByEmail.mockResolvedValue({ principal: CAROL, status: 'ok' } as never);
    const dialog = await openDialog(client);
    const input = within(dialog).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'org-carol@example.org' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(dialog).findByText('org-carol@example.org')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  it('gives read access to all folders and the default calendar and address book in one batch', async () => {
    const client = makeClient();
    const dialog = await openDialog(client);
    fireEvent.click(within(dialog).getAllByRole('option').find((o) => o.textContent?.includes('org-carol'))!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'apply_add' }));
    await waitFor(() => expect(client.applyShareChanges).toHaveBeenCalledTimes(1));
    const changes = client.applyShareChanges.mock.calls[0][0];
    expect(changes.map((c) => [c.kind, c.id, c.principalId])).toEqual([
      ['mailbox', 'a', 'ck'], ['mailbox', 'b', 'ck'], ['calendar', 'c', 'ck'], ['addressBook', 'd', 'ck'],
    ]);
    expect(changes[0].rights).toEqual(MAILBOX_PRESETS.read);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports the items that failed and tries only those again', async () => {
    let calls = 0;
    const client = makeClient({
      apply: (changes) => {
        calls += 1;
        return changes.map((change) => ({ change, ok: calls > 1 || change.kind !== 'calendar', error: calls > 1 ? undefined : 'You may not share this calendar' }));
      },
    });
    const dialog = await openDialog(client);
    fireEvent.click(within(dialog).getAllByRole('option').find((o) => o.textContent?.includes('org-carol'))!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'apply_add' }));
    const report = await within(dialog).findByRole('alert');
    expect(report).toHaveTextContent('partial_title');
    expect(report).toHaveTextContent('Calendar');
    expect(report).toHaveTextContent('You may not share this calendar');
    expect(report).not.toHaveTextContent('Inbox');

    fireEvent.click(within(dialog).getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(client.applyShareChanges).toHaveBeenCalledTimes(2));
    expect(client.applyShareChanges.mock.calls[1][0].map((c) => c.id)).toEqual(['c']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers only read when the admin allows only read', async () => {
    restrict({ delegationRights: { allowedValues: ['read'] } });
    const dialog = await openDialog(makeClient());
    const rights = within(dialog).getByTestId('delegate-rights');
    expect(within(rights).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['read']);
    expect(within(rights).getByText('org_locked')).toBeInTheDocument();
  });

  it('offers both without a restriction, and no lock note', async () => {
    const dialog = await openDialog(makeClient());
    const rights = within(dialog).getByTestId('delegate-rights');
    expect(within(rights).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['read', 'write']);
    expect(within(rights).queryByText('org_locked')).toBeNull();
  });

  it('keeps keys from the shortcuts behind it and closes on Escape', async () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      const dialog = await openDialog(makeClient());
      fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'e' });
      expect(onWindowKey).not.toHaveBeenCalled();
      fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('starts "Change" from what the person has, and replaces it', async () => {
    const client = makeClient({ withCarol: true });
    renderWith(client);
    const row = await screen.findByTestId('delegate-row');
    fireEvent.click(within(row).getByRole('button', { name: 'change' }));
    const dialog = await screen.findByRole('dialog');
    const checked = within(dialog).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked).map((r) => (r as HTMLInputElement).value);
    expect(checked).toEqual(['inbox', 'default', 'none', 'read']);
    fireEvent.click(within(dialog).getAllByRole('radio').find((r) => (r as HTMLInputElement).value === 'write')!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'apply_change' }));
    await waitFor(() => expect(client.applyShareChanges).toHaveBeenCalledTimes(1));
    const changes = client.applyShareChanges.mock.calls[0][0];
    expect(changes.map((c) => [c.id, (c.rights as Record<string, boolean> | null)?.mayAddItems ?? (c.rights as Record<string, boolean> | null)?.mayWriteAll])).toEqual([
      ['a', true], ['c', true],
    ]);
  });
});
