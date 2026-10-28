import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventDetailPopover } from '../event-detail-popover';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// CAL-13: Enter on an event opened the card but the focus stayed on the
// event: the card focused its first button while it was still hidden,
// before it had been placed.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: (d: Date | string) => String(d),
    relativeTime: (d: Date | string) => String(d),
    number: (n: number) => String(n),
  }),
}));

const calendar = {
  id: 'cal-1',
  name: 'Work',
  myRights: { mayWriteAll: true, mayWriteOwn: true },
} as unknown as Calendar;

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
} as unknown as CalendarEvent;

describe('EventDetailPopover focus', () => {
  it('takes the focus once it is visible, and gives it back to the event on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const visibilityAtFocus: string[] = [];
    const onFocusIn = (e: FocusEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[role="dialog"]');
      if (card) visibilityAtFocus.push(card.style.visibility);
    };
    document.addEventListener('focusin', onFocusIn);
    const { unmount } = render(
      <EventDetailPopover
        event={event}
        calendar={calendar}
        anchorRect={new DOMRect(100, 100, 50, 20)}
        pinned
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onClose={vi.fn()}
        onSaveNote={vi.fn()}
      />,
    );
    const card = screen.getByRole('dialog', { name: 'Review' });
    expect(card.contains(document.activeElement)).toBe(true);
    expect(visibilityAtFocus).toEqual(['visible']);
    unmount();
    document.removeEventListener('focusin', onFocusIn);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
