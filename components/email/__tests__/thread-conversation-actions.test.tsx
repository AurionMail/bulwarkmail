// The phone conversation view had Back and per-message Reply only: deleting or
// archiving a conversation meant going back and long-pressing its row. Its
// header now has the row's actions.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => ({ enabled: false }), canWopiOpen: () => false }));
vi.mock('@/hooks/use-own-domain-address', () => ({ useOwnDomainAddress: () => () => false }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const { ThreadConversationView } = await import('@/components/email/thread-conversation-view');

const email = {
  id: 'e1', threadId: 't1', mailboxIds: { a: true }, keywords: { $seen: true },
  from: [{ name: 'Sender', email: 'sender@t.example' }], to: [{ email: 'me@example.org' }],
  subject: 's', receivedAt: '2026-09-26T10:00:00Z', size: 1, preview: 'hi', hasAttachment: false,
  htmlBody: [], textBody: [], attachments: [], bodyValues: {},
};

describe('phone conversation header', () => {
  it('archives, deletes, reports spam and marks unread', () => {
    const handlers = { onArchive: vi.fn(), onDelete: vi.fn(), onToggleSpam: vi.fn(), onMarkUnread: vi.fn() };
    render(
      <ThreadConversationView
        thread={{ threadId: 't1', emails: [email], latestEmail: email } as never}
        emails={[email] as never}
        onBack={() => {}}
        mailboxRole="inbox"
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.mark_as_spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'context_menu.mark_unread' }));
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
  });
});
