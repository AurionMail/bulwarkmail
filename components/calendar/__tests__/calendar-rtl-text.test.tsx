import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventCard } from '../event-card';
import { CalendarSearchResults } from '../calendar-search';
import { CalendarAgendaView } from '../calendar-agenda-view';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// In Arabic, an English title took the page's direction (".Dinner with
// Carlos and co", cut at the start) and "09:15 – 09:30" read "09:30 – 09:15".

vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  displayNow: () => new Date(2026, 9, 28, 8, 0),
}));

const calendars = [{ id: 'cal-1', name: 'Work', color: '#123456' }] as unknown as Calendar[];
const dinner = {
  id: 'e1', '@type': 'Event', uid: 'e1', title: 'Dinner with Carlos and co.', start: '2026-10-28T09:15:00',
  duration: 'PT1H', showWithoutTime: false, status: 'confirmed', calendarIds: { 'cal-1': true },
} as unknown as CalendarEvent;

const isolatedLtr = (el: HTMLElement) => el.closest('bdi')?.getAttribute('dir') === 'ltr';

describe('user text and times in a right-to-left layout', () => {
  it.each(['chip', 'span', 'block'] as const)('gives the event title its own direction (%s)', (variant) => {
    render(<EventCard event={dinner} variant={variant} />);
    expect(screen.getByText('Dinner with Carlos and co.')).toHaveAttribute('dir', 'auto');
  });

  it('keeps start before end in a block', () => {
    render(<EventCard event={dinner} variant="block" />);
    expect(isolatedLtr(screen.getByText('09:15 – 10:15'))).toBe(true);
  });

  it('does the same in search results', () => {
    render(
      <CalendarSearchResults
        query="dinner"
        results={{ upcoming: [dinner], past: [], searching: false }}
        calendars={calendars}
        onSelectEvent={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: /Dinner/ });
    expect(within(row).getByText('Dinner with Carlos and co.')).toHaveAttribute('dir', 'auto');
    expect(isolatedLtr(within(row).getByText('09:15 – 10:15'))).toBe(true);
  });

  it('does the same in the agenda', () => {
    render(
      <CalendarAgendaView
        focus={{ date: new Date(2026, 9, 28), nonce: 0 }}
        windowKey="agenda:2026-10-28"
        rangeStart={new Date(2026, 9, 28)}
        rangeEnd={new Date(2026, 10, 3)}
        events={[dinner]}
        calendars={calendars}
        onSelectEvent={vi.fn()}
      />,
    );
    expect(screen.getByText('Dinner with Carlos and co.')).toHaveAttribute('dir', 'auto');
    expect(isolatedLtr(screen.getByText('09:15 – 10:15'))).toBe(true);
  });
});
