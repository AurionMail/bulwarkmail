import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarManagementSettings } from '../calendar-management-settings';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Calendar } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
  useLocale: () => 'en',
}));

const client = {
  getAccountId: () => 'acct',
  getPrincipals: vi.fn().mockResolvedValue([
    { id: 'g', type: 'individual', name: 'bot@example.com', email: 'bot@example.com', description: 'Booking robot' },
  ]),
};

beforeEach(() => {
  useAuthStore.setState({ client: client as never, serverUrl: null as never, username: null as never });
  useCalendarStore.setState({
    calendars: [{
      id: 'rdv', name: 'Meetings', color: '#3b82f6', sortOrder: 1, isDefault: false, isShared: false,
      shareWith: { g: { mayReadItems: true } },
      myRights: { mayWriteAll: true, mayWriteOwn: true, mayShare: true, mayDelete: true },
    } as unknown as Calendar],
    icalSubscriptions: [],
  } as never);
});

describe('Calendar settings share badge', () => {
  it('names whom the calendar is shared with', async () => {
    render(<CalendarManagementSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-shared-indicator')).toHaveAttribute(
        'title',
        'shared_with bot@example.com (Booking robot)',
      );
    });
  });
});
