import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderSettings } from '../folder-settings';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Mailbox } from '@/lib/jmap/types';

// #495: Stalwart's Scheduled mailbox carries role "scheduled"; the folder list
// renders `role_<role>` and the key must exist (see translations.test.ts).

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

describe('FolderSettings role label for the Scheduled mailbox (#495)', () => {
  beforeEach(() => {
    useAuthStore.setState({ client: null } as never);
    useEmailStore.setState({
      mailboxes: [
        makeMailbox({ id: 'inbox', name: 'Inbox', role: 'inbox' }),
        makeMailbox({ id: 'sched', name: 'Scheduled', role: 'scheduled' as never }),
      ],
      fetchMailboxes: vi.fn(),
    } as never);
  });

  it('renders the role badge through the role_scheduled key', () => {
    render(<FolderSettings />);
    // The test i18n mock echoes the key, so the badge shows the key itself.
    expect(screen.getByText('role_scheduled')).toBeInTheDocument();
  });
});
