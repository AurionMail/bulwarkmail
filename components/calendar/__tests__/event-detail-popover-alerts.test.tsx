import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventDetailPopover } from '../event-detail-popover';
import type { Calendar, CalendarEvent, CalendarEventAlert } from '@/lib/jmap/types';

// #1209: the popover listed only the first alert, as "before" even for email
// alerts, and nothing for an event on its calendar's defaults.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: (d: Date | string) => String(d),
    relativeTime: (d: Date | string) => String(d),
    number: (n: number) => String(n),
  }),
}));

const alert = (offset: string, action: CalendarEventAlert['action']): CalendarEventAlert => ({
  '@type': 'Alert',
  trigger: { '@type': 'OffsetTrigger', offset, relativeTo: 'start' },
  action,
  acknowledged: null,
  relatedTo: null,
});

const calendar = {
  id: 'cal-1',
  name: 'Work',
  myRights: { mayWriteAll: true, mayWriteOwn: true },
  defaultAlertsWithTime: { d1: alert('-PT30M', 'display') },
  defaultAlertsWithoutTime: null,
} as unknown as Calendar;

function renderPopover(overrides: Partial<CalendarEvent>) {
  const event = {
    id: 'evt-1',
    calendarIds: { 'cal-1': true },
    title: 'Review',
    start: '2026-11-20T10:00:00',
    duration: 'PT1H',
    timeZone: 'Europe/Berlin',
    showWithoutTime: false,
    participants: null,
    alerts: null,
    useDefaultAlerts: false,
    ...overrides,
  } as unknown as CalendarEvent;
  render(
    <EventDetailPopover
      event={event}
      calendar={calendar}
      anchorRect={new DOMRect(100, 100, 50, 20)}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onClose={vi.fn()}
      onSaveNote={vi.fn()}
    />,
  );
}

describe('EventDetailPopover reminders', () => {
  it('lists every alert and marks email alerts', () => {
    renderPopover({ alerts: { a: alert('-PT15M', 'display'), b: alert('-PT1H', 'email') } });
    expect(screen.getByText('alerts.minutes_before(15), alerts.by_email(alerts.hours_before(1))')).toBeTruthy();
  });

  it("shows the calendar's defaults for an event that uses them", () => {
    renderPopover({ useDefaultAlerts: true });
    expect(screen.getByText('alerts.minutes_before(30)')).toBeTruthy();
  });
});
