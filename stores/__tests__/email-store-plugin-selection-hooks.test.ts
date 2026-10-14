import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import type { Email, Mailbox } from '@/lib/jmap/types';

// onEmailSelectionChange and onMailboxChange follow the store state, so every
// path that changes the selection or the open folder fires them once.

function makeEmail(id: string, overrides: Partial<Email> = {}): Email {
  return { id, threadId: `t-${id}`, keywords: {}, mailboxIds: { inbox: true }, ...overrides } as Email;
}

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox' },
  { id: 'projects', name: 'Projects' },
] as Mailbox[];

beforeEach(() => {
  clearAllHooks();
  useEmailStore.setState({
    mailboxes,
    accountMailboxes: {},
    viewingAccountId: null,
    selectedMailbox: 'inbox',
    emails: [makeEmail('a'), makeEmail('b'), makeEmail('c', { sourceClientAccountId: 'x', sourceAccountId: 'y' })],
    selectedEmailKeys: new Set(),
    lastSelectedEmailKey: null,
    listRows: null,
  });
});

afterEach(() => clearAllHooks());

describe('onEmailSelectionChange', () => {
  it('reports the selected ids each time the selection changes', () => {
    const changed = vi.fn();
    emailHooks.onEmailSelectionChange.register('t', changed);
    const store = useEmailStore.getState();

    store.toggleEmailSelection(makeEmail('a'));
    store.selectRangeEmails(makeEmail('b'));
    store.selectAllEmails();
    store.clearSelection();
    // Clearing an empty selection is no change.
    store.clearSelection();

    expect(changed.mock.calls).toEqual([
      [{ emailIds: ['a'] }],
      [{ emailIds: ['a', 'b'] }],
      [{ emailIds: ['a', 'b', 'c'] }],
      [{ emailIds: [] }],
    ]);
  });
});

describe('onMailboxChange', () => {
  it('reports the folder opened, its role and the one left', () => {
    const changed = vi.fn();
    emailHooks.onMailboxChange.register('t', changed);

    useEmailStore.getState().selectMailbox('projects');
    useEmailStore.getState().selectMailbox('projects');
    useEmailStore.getState().selectMailbox('inbox');

    expect(changed.mock.calls).toEqual([
      [{ mailboxId: 'projects', role: null, previousMailboxId: 'inbox' }],
      [{ mailboxId: 'inbox', role: 'inbox', previousMailboxId: 'projects' }],
    ]);
  });
});
