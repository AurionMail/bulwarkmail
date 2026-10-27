import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { emailKeyFor } from '@/lib/thread-utils';
import type { Email } from '@/lib/jmap/types';

/**
 * Email ids are per-account, so the same id exists in several accounts
 * ("eiaaaabc" is an ordinary first id). Reported on #1013 by @alyyousuf7:
 * selection keyed by the bare id ticks both, and a batch action then hits a
 * message the user never selected.
 */
const twin = (account: string, subject: string): Email => ({
  id: 'eiaaaabc', threadId: 'taaaabc', blobId: `blob-${account}`,
  mailboxIds: { inbox: true }, keywords: {},
  from: [{ email: `someone@${account}` }], to: [], subject,
  receivedAt: '2026-09-19T08:00:00Z', size: 42, preview: '', hasAttachment: false,
  sourceClientAccountId: account, sourceAccountId: account,
} as unknown as Email);

const initialAuthState = useAuthStore.getState();
const initialEmailState = useEmailStore.getState();
const makeClient = () => ({
  batchDeleteEmails: vi.fn(async () => {}),
  getMailboxes: vi.fn(async () => []),
}) as unknown as IJMAPClient;
let clientA: IJMAPClient;
let clientB: IJMAPClient;

const mine = twin('account-a', 'mia');
const theirs = twin('account-b', 'di un altro account');

beforeEach(() => {
  clientA = makeClient();
  clientB = makeClient();
  useAuthStore.setState({
    activeAccountId: 'account-a', client: clientA,
    getClientForAccount: (id: string) => (id === 'account-a' ? clientA : id === 'account-b' ? clientB : undefined) as never,
  });
  useEmailStore.setState(initialEmailState, true);
  useEmailStore.setState({ emails: [mine, theirs], selectedEmailKeys: new Set(), lastSelectedEmailKey: null });
});

afterEach(() => {
  useEmailStore.setState(initialEmailState, true);
  useAuthStore.setState(initialAuthState, true);
});

describe('selection across accounts sharing an email id', () => {
  it('ticks only the row that was clicked', () => {
    useEmailStore.getState().toggleEmailSelection(mine);
    const { emails, selectedEmailKeys } = useEmailStore.getState();
    const affected = emails.filter(e => selectedEmailKeys.has(emailKeyFor(e)));
    expect(affected).toHaveLength(1);
    expect(affected[0]!.sourceAccountId).toBe('account-a');
  });

  it('unticks its namesake independently', () => {
    const store = useEmailStore.getState();
    store.toggleEmailSelection(mine);
    store.toggleEmailSelection(theirs);
    expect(useEmailStore.getState().selectedEmailKeys.size).toBe(2);
    store.toggleEmailSelection(theirs);
    const { selectedEmailKeys } = useEmailStore.getState();
    expect([...selectedEmailKeys]).toEqual([emailKeyFor(mine)]);
  });

  it('selects every account copy when the whole list is selected', () => {
    useEmailStore.getState().selectAllEmails();
    expect(useEmailStore.getState().selectedEmailKeys.size).toBe(2);
  });

  it('deletes only the selected account copy', async () => {
    useEmailStore.getState().toggleEmailSelection(theirs);
    expect(await useEmailStore.getState().batchDelete(clientA, true)).toBe(true);
    const remaining = useEmailStore.getState().emails;
    expect(remaining.map(e => e.sourceAccountId)).toEqual(['account-a']);
    expect(remaining[0]).toBe(mine);
    expect(clientB.batchDeleteEmails).toHaveBeenCalledTimes(1);
    expect(clientB.batchDeleteEmails).toHaveBeenCalledWith(['eiaaaabc'], 'account-b');
    expect(clientA.batchDeleteEmails).not.toHaveBeenCalled();
    expect(useEmailStore.getState().error).toBeNull();
  });

  it('retains both copies when the selected source client is unavailable', async () => {
    useAuthStore.setState({
      getClientForAccount: (id: string) => (id === 'account-a' ? clientA : undefined) as never,
    });
    useEmailStore.getState().toggleEmailSelection(theirs);
    expect(await useEmailStore.getState().batchDelete(clientA, true)).toBe(false);
    const state = useEmailStore.getState();
    expect(state.error).toBe('Not connected');
    expect(state.emails).toEqual([mine, theirs]);
    expect([...state.selectedEmailKeys]).toEqual([emailKeyFor(theirs)]);
    expect(clientA.batchDeleteEmails).not.toHaveBeenCalled();
    expect(clientB.batchDeleteEmails).not.toHaveBeenCalled();
  });
});
