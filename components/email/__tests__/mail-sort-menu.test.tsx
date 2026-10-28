import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { MailSortMenu, sortChoiceFor } from '../mail-list-menus';

// The mail list's Sort menu writes the "Message list order" setting, like the
// Files header's sort menu writes its own.

const fetchEmails = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  fetchEmails.mockClear();
  useSettingsStore.setState({ messageListOrder: [], messageListOrderScope: 'inbox' } as never);
  useAuthStore.setState({ client: { getEmailQuerySortOptions: () => null } } as never);
  useEmailStore.setState({ selectedMailbox: 'sent', fetchEmails } as never);
});

describe('mail list Sort menu', () => {
  it('checks the current order', () => {
    render(<MailSortMenu folderRole="inbox" />);
    fireEvent.click(screen.getByTestId('mail-sort'));
    expect(screen.getByTestId('mail-sort-newest').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('mail-sort-oldest').getAttribute('aria-checked')).toBe('false');
  });

  it('writes the setting, makes it reach this folder, and reloads the list', () => {
    render(<MailSortMenu folderRole="sent" />);
    fireEvent.click(screen.getByTestId('mail-sort'));
    fireEvent.click(screen.getByTestId('mail-sort-oldest'));
    const { messageListOrder, messageListOrderScope } = useSettingsStore.getState();
    expect(messageListOrder).toEqual([{ criterion: 'receivedAt', direction: 'asc' }]);
    // The order applied to the Inbox only, so in Sent the pick did nothing.
    expect(messageListOrderScope).toBe('all');
    expect(fetchEmails).toHaveBeenCalledWith(expect.anything(), 'sent', { background: true });
  });

  it('leaves out read state and stars when the server cannot order by them', () => {
    useAuthStore.setState({ client: { getEmailQuerySortOptions: () => ['receivedAt', 'from'] } } as never);
    render(<MailSortMenu folderRole="inbox" />);
    fireEvent.click(screen.getByTestId('mail-sort'));
    expect(screen.queryByTestId('mail-sort-unread')).toBeNull();
    expect(screen.getByTestId('mail-sort-sender')).toBeTruthy();
  });

  it('recognises the orders Settings can make', () => {
    expect(sortChoiceFor([{ criterion: 'unread', direction: 'desc' }, { criterion: 'receivedAt', direction: 'desc' }])).toBe('unread');
    expect(sortChoiceFor([{ criterion: 'unread', direction: 'desc' }, { criterion: 'from', direction: 'asc' }])).toBeNull();
  });
});
