import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarSidebarPanel } from '../calendar-sidebar-panel';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, Principal } from '@/lib/jmap/types';

// Show interpolated values, so the tests can read whom a calendar is shared with.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
  useLocale: () => 'en',
}));

function cal(overrides: Partial<Calendar>): Calendar {
  return {
    id: 'c', name: 'Cal', color: '#3b82f6', sortOrder: 0, isSubscribed: true, isVisible: true,
    isDefault: false, includeInAvailability: 'all', timeZone: null, shareWith: null,
    myRights: { mayWriteOwn: true, mayShare: true, mayDelete: true },
    ...overrides,
  } as unknown as Calendar;
}

const rights = { mayReadItems: true };

function clientWith(principals: Principal[]): IJMAPClient {
  return {
    getAccountId: () => 'acct',
    getPrincipals: vi.fn().mockResolvedValue(principals),
  } as unknown as IJMAPClient;
}

describe('CalendarSidebarPanel shared calendars', () => {
  it('names whom a calendar is shared with', async () => {
    const client = clientWith([
      { id: 'g', type: 'individual', name: 'bot@example.com', email: 'bot@example.com', description: 'Booking robot' },
      { id: 'h', type: 'individual', name: 'alice', email: 'alice@example.com', description: null },
    ]);
    render(
      <CalendarSidebarPanel
        calendars={[cal({ id: 's', name: 'Meetings', shareWith: { g: rights, h: rights } as never })]}
        selectedCalendarIds={[]}
        onToggleVisibility={() => {}}
        client={client}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('calendar-shared-indicator')).toHaveAttribute(
        'title',
        'shared_with bot@example.com (Booking robot), alice@example.com',
      );
    });
  });

  it('falls back to a count while a recipient is unknown', async () => {
    const client = clientWith([]);
    render(
      <CalendarSidebarPanel
        calendars={[cal({ id: 's', name: 'Meetings', shareWith: { g: rights } as never })]}
        selectedCalendarIds={[]}
        onToggleVisibility={() => {}}
        client={client}
      />,
    );

    await waitFor(() => expect(client.getPrincipals).toHaveBeenCalled());
    expect(screen.getByTestId('calendar-shared-indicator')).toHaveAttribute('title', 'shared_with_count 1');
  });

  it('fetches no principals when nothing is shared', () => {
    const client = clientWith([]);
    render(
      <CalendarSidebarPanel
        calendars={[cal({ id: 'a', name: 'Work' })]}
        selectedCalendarIds={[]}
        onToggleVisibility={() => {}}
        client={client}
      />,
    );
    expect(client.getPrincipals).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calendar-shared-indicator')).toBeNull();
  });
});
