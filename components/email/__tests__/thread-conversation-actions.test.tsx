// The phone conversation view had Back and per-message Reply only: deleting or
// archiving a conversation meant going back and long-pressing its row. Its
// header now has Archive, Delete, Move and a ⋮ with the row's other actions.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => ({ enabled: false }), canWopiOpen: () => false }));
vi.mock('@/hooks/use-own-domain-address', () => ({ useOwnDomainAddress: () => () => false }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const { ThreadConversationView } = await import('@/components/email/thread-conversation-view');

const email = {
  id: 'e1', threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: true },
  from: [{ name: 'Sender', email: 'sender@t.example' }], to: [{ email: 'me@example.org' }],
  subject: 's', receivedAt: '2026-09-26T10:00:00Z', size: 1, preview: 'hi', hasAttachment: false,
  htmlBody: [], textBody: [], attachments: [], bodyValues: {},
};

const rights = { mayAddItems: true, mayReadItems: true, mayRemoveItems: true };
const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', sortOrder: 0, totalEmails: 1, unreadEmails: 0, myRights: rights },
  { id: 'projects', name: 'Projects', sortOrder: 5, totalEmails: 0, unreadEmails: 0, myRights: rights },
];

function renderView(actions: Record<string, unknown>) {
  render(
    <ThreadConversationView
      thread={{ threadId: 't1', emails: [email], latestEmail: email } as never}
      emails={[email] as never}
      onBack={() => {}}
      mailboxRole="inbox"
      actions={{ mailboxes: mailboxes as never, selectedMailbox: 'inbox', currentMailboxRole: 'inbox', ...actions }}
    />,
  );
}

describe('phone conversation header', () => {
  it('archives and deletes', () => {
    const handlers = { onArchive: vi.fn(), onDelete: vi.fn() };
    renderView(handlers);
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.delete' }));
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
  });

  it('moves to a folder picked from Move', () => {
    const onMoveToMailbox = vi.fn();
    renderView({ onMoveToMailbox });
    fireEvent.click(screen.getByRole('button', { name: 'email_viewer.move_to' }));
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByText('Projects'));
    expect(onMoveToMailbox).toHaveBeenCalledWith('projects');
  });

  it('offers the rest of the message actions under ⋮: Report spam, Mark as unread', () => {
    const handlers = { onMarkAsSpam: vi.fn(), onMarkAsRead: vi.fn() };
    renderView(handlers);
    fireEvent.click(screen.getByRole('button', { name: 'email_viewer.more_actions' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText(/mark_as_spam/));
    expect(handlers.onMarkAsSpam).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'email_viewer.more_actions' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText(/mark_unread/));
    expect(handlers.onMarkAsRead).toHaveBeenCalledWith(false);
  });

  it('keeps a long subject to two lines', () => {
    renderView({});
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('line-clamp-2');
  });
});

// In Arabic the per-message "Reply all" and "Forward" were cut with no way to
// read them, and the count said "3 رسالة" (one form for every number).
describe('phone conversation messages', () => {
  it('counts the messages with the plural message', () => {
    renderView({});
    expect(screen.getByText('threads.messages_count')).toBeTruthy();
  });

  it('wraps the reply buttons instead of cutting their names', () => {
    render(
      <ThreadConversationView
        thread={{ threadId: 't1', emails: [email], latestEmail: email } as never}
        emails={[email] as never}
        onBack={() => {}}
        onReply={() => {}}
        onReplyAll={() => {}}
        onForward={() => {}}
      />,
    );
    const replyAll = screen.getByRole('button', { name: 'email_viewer.reply_all' });
    expect(replyAll.parentElement?.className).toContain('flex-wrap');
    for (const name of ['email_viewer.reply', 'email_viewer.reply_all', 'email_viewer.forward']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).not.toContain('min-w-0');
      expect(button.querySelector('.truncate')).toBeNull();
    }
  });
});
