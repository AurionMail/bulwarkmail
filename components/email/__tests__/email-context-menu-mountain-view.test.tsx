import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('../rules-menu', () => ({ RulesContextSubMenu: () => null }));
vi.mock('@/hooks/use-copy-link', () => ({ useCopyLink: () => vi.fn() }));

const { EmailContextMenu } = await import('../email-context-menu');

const rights = { mayAddItems: true } as Mailbox['myRights'];
const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', myRights: rights },
  { id: 'archive', name: 'Archive', role: 'archive', myRights: rights },
] as unknown as Mailbox[];
const email = {
  id: 'e1',
  keywords: { $seen: true },
  mailboxIds: { inbox: true },
  from: [{ name: 'Sarah Kim', email: 'sarah@example.com' }],
} as unknown as Email;

function renderMenu(props: Partial<React.ComponentProps<typeof EmailContextMenu>> = {}) {
  return render(
    <EmailContextMenu
      email={email}
      position={{ x: 0, y: 0 }}
      isOpen
      onClose={() => {}}
      menuRef={{ current: null }}
      mailboxes={mailboxes}
      selectedMailbox="inbox"
      onArchive={() => {}}
      onDelete={() => {}}
      {...props}
    />,
  );
}

/** The menu's entries by test id, top to bottom. */
const order = () => [...document.querySelectorAll('[data-testid^="ctx-"]')].map((e) => e.getAttribute('data-testid'));

describe('message menu under Mountain View', () => {
  beforeEach(() => useSettingsStore.setState({ interfaceLayout: 'mountain-view' } as never));

  it("puts Mark as read with Archive and Delete, before Move to, as Gmail does", () => {
    renderMenu();
    const ids = order();
    expect(ids.indexOf('ctx-delete')).toBeLessThan(ids.indexOf('ctx-mark-unread'));
    expect(ids.indexOf('ctx-mark-unread')).toBeLessThan(ids.indexOf('ctx-move-to'));
  });

  it('finds the mail from the sender', () => {
    const onFindFromSender = vi.fn();
    renderMenu({ onFindFromSender });
    fireEvent.click(screen.getByTestId('ctx-find-from'));
    expect(onFindFromSender).toHaveBeenCalledTimes(1);
  });

  it('keeps the default order outside Mountain View', () => {
    useSettingsStore.setState({ interfaceLayout: 'default' } as never);
    renderMenu({ onFindFromSender: vi.fn() });
    const ids = order();
    expect(ids.indexOf('ctx-move-to')).toBeLessThan(ids.indexOf('ctx-mark-unread'));
  });
});
