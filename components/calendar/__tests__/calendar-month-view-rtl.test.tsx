import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// In Arabic the day grid mirrors, but the event chips laid over it were
// placed with `left`, so Sunday's event was drawn under Monday. And the
// phone's weekday headers were the first two letters of each name ("اث").
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({ 'days.mon': 'الاثنين' } as Record<string, string>)[key] ?? key,
  useLocale: () => 'ar',
  useFormatter: () => ({
    dateTime: (d: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ar', options).format(d),
  }),
}));

import { CalendarMonthView } from '../calendar-month-view';

const calendars = [{ id: 'cal-1', name: 'Work', color: '#123456' }] as unknown as Calendar[];
const birthday = {
  id: 'e1', uid: 'u1', title: 'Birthday', start: '2026-10-07T00:00:00', duration: 'P1D', showWithoutTime: true,
  calendarIds: { 'cal-1': true }, status: 'confirmed',
} as unknown as CalendarEvent;

function renderMonth(isMobile = false) {
  return render(
    <CalendarMonthView
      focus={{ date: new Date(2026, 9, 7), nonce: 0 }}
      windowKey="month:2026-10-07"
      rangeStart={new Date(2026, 8, 28)}
      rangeEnd={new Date(2026, 10, 1)}
      selectedDate={new Date(2026, 9, 7)}
      events={[birthday]}
      calendars={calendars}
      onSelectDate={vi.fn()}
      onSelectEvent={vi.fn()}
      isMobile={isMobile}
    />,
  );
}

describe('CalendarMonthView in a right-to-left language', () => {
  it('places event chips from the start edge, so they follow the mirrored grid', () => {
    renderMonth();
    const chip = screen.getByRole('button', { name: /Birthday/ }).parentElement as HTMLElement;
    // Wednesday is the third column of a week starting on Monday.
    expect(chip.style.insetInlineStart).toMatch(/^calc\(28\.57\d*% \+ 1px\)$/);
    expect(chip.style.left).toBe('');
  });

  it('heads the phone grid with the language\'s short weekday names', () => {
    renderMonth(true);
    const monday = screen.getAllByRole('columnheader')[0];
    expect(monday.textContent).toBe(new Intl.DateTimeFormat('ar', { weekday: 'narrow' }).format(new Date(2026, 8, 28)));
    expect(monday.textContent).not.toBe('ال');
  });
});
