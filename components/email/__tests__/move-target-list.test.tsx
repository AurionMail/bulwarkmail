import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MailboxNode } from '@/lib/utils';
import { MoveTargetList } from '../move-target-list';

// The reader's Move menus show the names the sidebar shows (Stalwart's
// "Sent Items" / "Junk Mail" / "Deleted Items" are Sent, Spam and Trash, in
// the user's language), and indent subfolders on the reading side.

const node = (id: string, name: string, role: string | undefined, children: MailboxNode[] = []) =>
  ({ id, name, role, children, depth: 0 }) as unknown as MailboxNode;

const tree = [
  node('sent', 'Sent Items', 'sent'),
  node('junk', 'Junk Mail', 'junk'),
  node('archive', 'Archive', 'archive', [node('y2025', '2025', undefined)]),
];

describe('MoveTargetList', () => {
  it('shows the localized folder names and moves on a pick', () => {
    const onPick = vi.fn();
    render(<MoveTargetList tree={tree} targetIds={new Set(['sent', 'junk', 'archive', 'y2025'])} onPick={onPick} />);
    // The i18n mock returns the key: the role's name, not the server's.
    expect(screen.queryByText('Sent Items')).toBeNull();
    expect(screen.getByText('mailboxes.sent')).toBeTruthy();
    fireEvent.click(screen.getByText('mailboxes.spam'));
    expect(onPick).toHaveBeenCalledWith('junk');
  });

  it('indents subfolders with a logical padding', () => {
    render(<MoveTargetList tree={tree} targetIds={new Set(['y2025'])} onPick={vi.fn()} />);
    const row = screen.getByText('2025').closest('button')!;
    expect(row.style.paddingInlineStart).toBe('1.75rem');
    expect(row.style.paddingLeft).toBe('');
  });
});
