import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderSettings } from '../folder-settings';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Mailbox } from '@/lib/jmap/types';

// On the phone the counter select and the row's icon buttons left no room
// for the folder name. They sit behind a ⋮ there, which right-click opens
// too, and the name keeps its full text in a tooltip.

vi.mock('../settings-section', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-section')>()),
  SettingsSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const rights = {
  mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true,
  mayCreateChild: true, mayRename: true, mayDelete: true, maySubmit: true,
};

function makeMailbox(overrides: Partial<Mailbox>): Mailbox {
  return {
    id: 'mb', name: 'Folder', sortOrder: 0, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0,
    myRights: rights, isSubscribed: true, isShared: false, ...overrides,
  } as Mailbox;
}

describe('FolderSettings row actions menu', () => {
  beforeEach(() => {
    useAuthStore.setState({ client: null } as never);
    useSettingsStore.setState({ folderCountModes: {} } as never);
    useEmailStore.setState({
      mailboxes: [makeMailbox({ id: 'projects', name: 'Projects with a long name' })],
      fetchMailboxes: vi.fn(),
    } as never);
  });

  it('opens the row actions from a named ⋮ and sets the counter from it', () => {
    render(<FolderSettings />);
    expect(screen.getByTitle('Projects with a long name')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'create_subfolder' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'rename' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'delete' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'counter' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'count_mode_none' }));
    expect(useSettingsStore.getState().folderCountModes).toEqual({ projects: 'none' });
  });

  it('opens the same menu on right-click and starts renaming from it', () => {
    render(<FolderSettings />);
    fireEvent.contextMenu(screen.getByTitle('Projects with a long name'), { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename' }));
    expect((screen.getByDisplayValue('Projects with a long name') as HTMLInputElement).tagName).toBe('INPUT');
  });

  it('names the expand toggle of a folder with subfolders', () => {
    useEmailStore.setState({
      mailboxes: [
        makeMailbox({ id: 'p', name: 'Parent' }),
        makeMailbox({ id: 'c', name: 'Child', parentId: 'p' }),
      ],
    } as never);
    render(<FolderSettings />);
    const toggle = screen.getByRole('button', { name: 'expand' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
