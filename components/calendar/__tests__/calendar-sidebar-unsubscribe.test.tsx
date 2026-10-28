import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarSidebarPanel } from '../calendar-sidebar-panel';
import { useCalendarStore } from '@/stores/calendar-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar } from '@/lib/jmap/types';

// Unsubscribing removes the feed's calendar and every event in it. Settings
// asked first, the sidebar's menu removed it at once.

const feed = {
  id: 'feed', name: 'Holidays', color: '#3b82f6', sortOrder: 0, isSubscribed: true, isVisible: true,
  isDefault: false, includeInAvailability: 'none', timeZone: null, shareWith: null,
  myRights: { mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayDelete: true },
} as unknown as Calendar;

describe('CalendarSidebarPanel unsubscribe', () => {
  it('asks before it removes a subscribed calendar', async () => {
    const removeICalSubscription = vi.fn().mockResolvedValue(undefined);
    useCalendarStore.setState({
      icalSubscriptions: [{ id: 'sub', url: 'https://example.com/h.ics', calendarId: 'feed', name: 'Holidays', color: '#3b82f6', refreshInterval: 60, lastRefreshed: null }],
      isSubscriptionCalendar: (id: string) => id === 'feed',
      removeICalSubscription,
    } as never);
    const client = { getAccountId: () => 'acct' } as unknown as IJMAPClient;
    render(<CalendarSidebarPanel calendars={[feed]} selectedCalendarIds={['feed']} onToggleVisibility={() => {}} client={client} />);

    fireEvent.contextMenu(screen.getByTestId('calendar-item'), { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'unsubscribe' }));
    const ask = await screen.findByRole('alertdialog', { name: 'delete_dialog.subscription_title' });
    expect(removeICalSubscription).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole('button', { name: 'unsubscribe' }));
    await waitFor(() => expect(removeICalSubscription).toHaveBeenCalledWith(client, 'sub'));
  });
});
