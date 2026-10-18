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
  markAsRead: vi.fn().mockResolvedValue(undefined),
  toggleStar: vi.fn().mockResolvedValue(undefined),
  batchUpdateKeywords: vi.fn().mockResolvedValue(undefined),
  markAsSpam: vi.fn().mockResolvedValue(undefined),
  undoSpam: vi.fn().mockResolvedValue(undefined),
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

/**
 * The other single-email actions resolved the row by its bare id as well, so in
 * a merged view a hover star, a hover or menu read toggle, a tag or "spam" went
 * to the FIRST row with that id - another account's message (measured against
 * Stalwart 0.16: the hover star on one account's Sent message flagged another
 * account's). With the row's key each reaches only the clicked row.
 */
describe('keyword and spam actions with a namesake in another account', () => {
  beforeEach(() => {
    useEmailStore.setState({
      emails: [above, { ...clicked, keywords: {} } as Email],
      selectedEmail: null,
      processingReadStatus: new Set(),
    } as never);
  });

  it('stars only the clicked row', async () => {
    await useEmailStore.getState().toggleStar(clientA, clicked.id, emailKeyFor(clicked));

    expect(clientB.toggleStar).toHaveBeenCalledWith('eiaaaabc', true, 'account-b');
    expect(clientA.toggleStar).not.toHaveBeenCalled();
    const [a, b] = useEmailStore.getState().emails;
    expect(a.keywords.$flagged).toBeFalsy();
    expect(b.keywords.$flagged).toBe(true);
  });

  it('marks only the clicked row read', async () => {
    await useEmailStore.getState().markAsRead(clientA, clicked.id, true, emailKeyFor(clicked));

    expect(clientB.markAsRead).toHaveBeenCalledWith('eiaaaabc', true, 'account-b');
    expect(clientA.markAsRead).not.toHaveBeenCalled();
    const [a, b] = useEmailStore.getState().emails;
    expect(a.keywords.$seen).toBe(true);
    expect(b.keywords.$seen).toBe(true);
  });

  it('marks only the clicked row unread and leaves the namesake read', async () => {
    useEmailStore.setState({ emails: [above, clicked] } as never);
    await useEmailStore.getState().markAsRead(clientA, clicked.id, false, emailKeyFor(clicked));

    expect(clientB.markAsRead).toHaveBeenCalledWith('eiaaaabc', false, 'account-b');
    expect(clientA.markAsRead).not.toHaveBeenCalled();
    const [a, b] = useEmailStore.getState().emails;
    expect(a.keywords.$seen).toBe(true);
    expect(b.keywords.$seen).toBeFalsy();
  });

  it('writes a keyword change only to the clicked row', async () => {
    await useEmailStore.getState().patchEmailKeywords(clientA, clicked.id, { $label1: true }, emailKeyFor(clicked));

    expect(clientB.batchUpdateKeywords).toHaveBeenCalledWith(['eiaaaabc'], { 'keywords/$label1': true }, 'account-b');
    expect(clientA.batchUpdateKeywords).not.toHaveBeenCalled();
    const [a, b] = useEmailStore.getState().emails;
    expect(a.keywords.$label1).toBeUndefined();
    expect(b.keywords.$label1).toBe(true);
  });

  it('without a key keeps the previous single-account behaviour (bare id)', async () => {
    useEmailStore.setState({ isUnifiedView: false, emails: [{ ...clicked, sourceClientAccountId: undefined, sourceAccountId: undefined } as Email] } as never);
    await useEmailStore.getState().toggleStar(clientA, clicked.id);

    expect(clientA.toggleStar).toHaveBeenCalledWith('eiaaaabc', true, undefined);
  });
});

/**
 * Spam and "not spam" took the row by its bare id too, the toast's undo cache
 * was keyed by it, and the next open message was picked by it: with a namesake
 * listed above, both rows dropped out of the selection walk.
 */
describe('spam actions with a namesake in another account', () => {
  it('reports only the clicked row and opens the namesake next', async () => {
    await useEmailStore.getState().markAsSpam(clientA, clicked.id, emailKeyFor(clicked));

    expect(clientB.markAsSpam).toHaveBeenCalledWith('eiaaaabc', 'account-b', false);
    expect(clientA.markAsSpam).not.toHaveBeenCalled();
    const state = useEmailStore.getState();
    expect(state.emails.map(e => e.sourceAccountId)).toEqual(['account-a']);
    expect(state.selectedEmail?.sourceAccountId).toBe('account-a');
  });

  it('moves only the clicked row out of junk with "not spam"', async () => {
    // The list is refetched after the move; keep the local result in view.
    useEmailStore.setState({ fetchUnifiedEmails: vi.fn() } as never);
    await useEmailStore.getState().undoSpam(clientA, clicked.id, emailKeyFor(clicked));

    expect(clientB.undoSpam).toHaveBeenCalledWith('eiaaaabc', 'a', 'account-b');
    expect(clientA.undoSpam).not.toHaveBeenCalled();
    const state = useEmailStore.getState();
    expect(state.emails.map(e => e.sourceAccountId)).toEqual(['account-a']);
    expect(state.selectedEmail?.sourceAccountId).toBe('account-a');
  });

  it('keeps one undo entry per row when both namesakes are reported', async () => {
    useEmailStore.setState({ spamUndoCache: new Map() } as never);
    await useEmailStore.getState().markAsSpam(clientA, clicked.id, emailKeyFor(clicked));
    useEmailStore.setState({ emails: [above] } as never);
    await useEmailStore.getState().markAsSpam(clientA, above.id, emailKeyFor(above));

    await useEmailStore.getState().undoSpam(clientA, clicked.id, emailKeyFor(clicked));

    expect(clientB.undoSpam).toHaveBeenCalledWith('eiaaaabc', 'a', 'account-b');
    expect(clientA.undoSpam).not.toHaveBeenCalled();
  });
});
