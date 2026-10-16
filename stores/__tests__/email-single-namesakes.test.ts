import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '../settings-store';
import { emailKeyFor } from '@/lib/thread-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

/**
 * Deleting one row of the unified view while another account holds a message
 * with the same id (Stalwart hands out the same ids, and the same trash id,
 * in every account). The action must reach the row that was clicked and leave
 * its namesake listed and untouched (#857).
 */
const twin = (account: string, receivedAt: string): Email => ({
  id: 'eiaaaabc', threadId: `t-${account}`, blobId: `blob-${account}`,
  mailboxIds: { 'a': true }, keywords: { $seen: true },
  from: [{ email: `someone@${account}` }], to: [], subject: account,
  receivedAt, size: 42, preview: '', hasAttachment: false,
  sourceClientAccountId: account, sourceAccountId: account,
} as unknown as Email);

const mailbox = (overrides: Partial<Mailbox>): Mailbox => ({
  id: 'a', name: 'Inbox', sortOrder: 0,
  totalEmails: 1, unreadEmails: 0, totalThreads: 1, unreadThreads: 0,
  myRights: {
    mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true,
    maySetKeywords: true, mayCreateChild: true, mayRename: true, mayDelete: true, maySubmit: true,
  },
  isSubscribed: true, isShared: false,
  ...overrides,
} as Mailbox);

const makeClient = () => ({
  moveEmail: vi.fn().mockResolvedValue(undefined),
  moveToTrash: vi.fn().mockResolvedValue(undefined),
  deleteEmail: vi.fn().mockResolvedValue(undefined),
  getMailboxes: vi.fn().mockResolvedValue([]),
}) as unknown as IJMAPClient & Record<string, ReturnType<typeof vi.fn>>;

// The list is newest first: account A's namesake sits right above the row
// that gets deleted.
const above = twin('account-a', '2026-10-16T09:00:00Z');
const clicked = twin('account-b', '2026-10-16T08:00:00Z');
let clientA: ReturnType<typeof makeClient>;
let clientB: ReturnType<typeof makeClient>;

const accountMailboxes = (account: string) => [
  mailbox({ id: 'a', role: 'inbox', accountId: account }),
  mailbox({ id: 'b', name: 'Trash', role: 'trash', accountId: account }),
];

beforeEach(() => {
  clientA = makeClient();
  clientB = makeClient();
  useAuthStore.setState({
    activeAccountId: 'account-a',
    client: clientA,
    getClientForAccount: (id: string) =>
      (id === 'account-a' ? clientA : id === 'account-b' ? clientB : undefined) as never,
  } as never);
  useSettingsStore.setState({ deleteAction: 'trash' } as never);
  useEmailStore.setState({
    isUnifiedView: true,
    unifiedRole: 'inbox',
    selectedMailbox: '',
    selectedKeyword: null,
    emails: [above, clicked],
    selectedEmail: clicked,
    selectedEmailKeys: new Set(),
    mailboxes: [],
    accountMailboxes: {
      'account-a': accountMailboxes('account-a'),
      'account-b': accountMailboxes('account-b'),
    },
    error: null,
  } as never);
});

describe('single-email actions with a namesake in another account', () => {
  it('moves only the clicked row to trash and keeps the row above it', async () => {
    await useEmailStore.getState().moveToMailbox(clientA, clicked.id, 'b', emailKeyFor(clicked));

    expect(clientB.moveEmail).toHaveBeenCalledWith('eiaaaabc', 'b', 'account-b');
    expect(clientA.moveEmail).not.toHaveBeenCalled();
    const state = useEmailStore.getState();
    expect(state.emails.map(e => e.sourceAccountId)).toEqual(['account-a']);
    expect(state.selectedEmail?.sourceAccountId).toBe('account-a');
  });

  it('permanently deletes only the clicked row', async () => {
    await useEmailStore.getState().deleteEmail(clientA, clicked.id, true, emailKeyFor(clicked));

    expect(clientB.deleteEmail).toHaveBeenCalledWith('eiaaaabc', 'account-b');
    expect(clientA.deleteEmail).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails.map(e => e.sourceAccountId)).toEqual(['account-a']);
  });

  it('moves only the clicked row with the trash delete action', async () => {
    await useEmailStore.getState().deleteEmail(clientA, clicked.id, false, emailKeyFor(clicked));

    expect(clientB.moveToTrash).toHaveBeenCalledWith('eiaaaabc', 'b', 'account-b', false);
    expect(clientA.moveToTrash).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails.map(e => e.sourceAccountId)).toEqual(['account-a']);
  });
});
