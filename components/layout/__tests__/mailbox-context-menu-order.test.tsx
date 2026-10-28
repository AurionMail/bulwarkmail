import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// R6: destructive entries come last. The folder menu had Refresh after
// "Delete folder".

vi.mock('@/components/email/rules-menu', () => ({ FolderRulesSubMenu: () => null }));

const { MailboxContextMenu } = await import('../mailbox-context-menu');

const folder = { id: 'p', name: 'Projects', sortOrder: 1, totalEmails: 2, unreadEmails: 0, myRights: {} } as unknown as Mailbox;

describe('MailboxContextMenu', () => {
  it('ends with Empty folder and Delete folder', () => {
    render(
      <MailboxContextMenu
        target={{ kind: 'mailbox', mailbox: folder, hasChildren: false }}
        position={{ x: 0, y: 0 }}
        isOpen
        onClose={vi.fn()}
        menuRef={{ current: null }}
        mailboxes={[folder]}
        onEmptyFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onRefresh={vi.fn()}
        onImportEmail={vi.fn()}
      />,
    );
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels.slice(-2)).toEqual(['empty_folder_generic', 'delete_folder']);
    expect(labels).toContain('refresh');
  });
});
