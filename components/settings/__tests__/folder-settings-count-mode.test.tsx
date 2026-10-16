import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderSettings } from '../folder-settings';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Mailbox } from '@/lib/jmap/types';

// #982: each folder row has a counter select that stores a per-folder override.

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

describe('FolderSettings counter mode (#982)', () => {
  beforeEach(() => {
    useAuthStore.setState({ client: null } as never);
    useSettingsStore.setState({ folderCountModes: { other: 'none' } } as never);
    useEmailStore.setState({
      mailboxes: [makeMailbox({ id: 'drafts', name: 'Drafts', role: 'drafts' })],
      fetchMailboxes: vi.fn(),
    } as never);
  });

  it('stores the chosen mode for the folder and removes it again on default', () => {
    render(<FolderSettings />);
    const select = screen.getByRole('combobox', { name: /count_mode/ }) as HTMLSelectElement;
    expect(select.value).toBe('');

    fireEvent.change(select, { target: { value: 'all' } });
    expect(useSettingsStore.getState().folderCountModes).toEqual({ other: 'none', drafts: 'all' });
    expect(select.value).toBe('all');

    fireEvent.change(select, { target: { value: '' } });
    expect(useSettingsStore.getState().folderCountModes).toEqual({ other: 'none' });
  });
});
