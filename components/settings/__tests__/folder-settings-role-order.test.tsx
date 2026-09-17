import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderSettings } from '../folder-settings';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Mailbox } from '@/lib/jmap/types';

// #984: the role assignment dropdowns listed folders in raw server order.
// They must follow the sidebar order the folder tree produces.

vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeMailbox(overrides: Partial<Mailbox>): Mailbox {
  return {
    id: 'mb',
    name: 'Folder',
    sortOrder: 0,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: true,
      mayRename: true,
      mayDelete: true,
      maySubmit: true,
    },
    isSubscribed: true,
    isShared: false,
    ...overrides,
  } as Mailbox;
}

describe('FolderSettings role dropdown order (#984)', () => {
  beforeEach(() => {
    useAuthStore.setState({ client: null } as never);
    useEmailStore.setState({
      // Deliberately unsorted: a child before its parent, a plain folder
      // before the Inbox, and names out of alphabetical order.
      mailboxes: [
        makeMailbox({ id: 'zeta', name: 'Zeta' }),
        makeMailbox({ id: 'proj-b', name: 'Beta', parentId: 'projects' }),
        makeMailbox({ id: 'inbox', name: 'Inbox', role: 'inbox' }),
        makeMailbox({ id: 'projects', name: 'Projects' }),
        makeMailbox({ id: 'proj-a', name: 'Alpha', parentId: 'projects' }),
        makeMailbox({ id: 'alpha', name: 'Alpha' }),
      ],
      fetchMailboxes: vi.fn(),
    } as never);
  });

  it('lists options in folder-tree order, children under their parent', () => {
    render(<FolderSettings />);

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    const values = within(selects[0] as HTMLElement)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');

    expect(values).toEqual(['inbox', 'alpha', 'projects', 'proj-a', 'proj-b', 'zeta']);
  });
});
