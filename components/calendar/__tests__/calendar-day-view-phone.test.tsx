import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarDayView } from '../calendar-day-view';
import type { Calendar, CalendarEvent, CalendarTask } from '@/lib/jmap/types';

// CAL-27 follow-up: the phone day view drew tasks as 10px chips with a
// circle too small to tap, and a busy neighbouring day left an empty
// all-day block of ~150px above the hours of a day with none.

const calendars = [{ id: 'cal-1', name: 'Work', color: '#123456' }] as unknown as Calendar[];

const holiday = {
  id: 'ev-1', calendarIds: { 'cal-1': true }, title: 'Holiday', start: '2026-09-10T00:00:00',
  duration: 'P1D', showWithoutTime: true,
} as unknown as CalendarEvent;

const task = {
  id: 't1', '@type': 'Task', title: 'Buy milk', calendarIds: { 'cal-1': true },
  progress: 'needs-action', priority: 0, due: '2026-09-09', showWithoutTime: true,
} as unknown as CalendarTask;

function renderDay(isMobile: boolean, tasks: CalendarTask[] = [task]) {
  return render(
    <CalendarDayView
      focus={{ date: new Date(2026, 8, 9), nonce: 0 }}
      windowKey="day:2026-09-08"
      rangeStart={new Date(2026, 8, 8)}
      rangeEnd={new Date(2026, 8, 10)}
      selectedDate={new Date(2026, 8, 9)}
      events={[holiday]}
      calendars={calendars}
      tasks={tasks}
      onSelectEvent={vi.fn()}
      onCreateAtTime={vi.fn()}
      isMobile={isMobile}
    />,
  );
}

describe('day view on a phone', () => {
  it('gives each task a full row with a 44px target for the circle', () => {
    renderDay(true);
    const chip = document.querySelector<HTMLElement>('[data-calendar-task="t1"]')!;
    expect(chip).toHaveClass('min-h-11', 'text-xs');
    expect(within(chip).getByRole('button', { name: /mark_complete|Mark as complete/i })).toHaveClass('w-11', 'self-stretch');
  });

  it('keeps the small shared chip on a wide screen', () => {
    renderDay(false);
    const chip = document.querySelector<HTMLElement>('[data-calendar-task="t1"]')!;
    expect(chip).toHaveClass('h-full', 'text-[10px]');
  });

  it('sizes the all-day row by the day in view, not by a busy neighbour', () => {
    renderDay(true, []);
    const today = document.querySelector<HTMLElement>('[data-day="2026-09-09"]')!;
    const next = document.querySelector<HTMLElement>('[data-day="2026-09-10"]')!;
    // The day in view has nothing all-day: no empty block under its date.
    expect(within(today).queryByText(/all_day|All day/i)).toBeNull();
    expect(today).not.toHaveClass('h-0');
    // The neighbour's all-day event takes no height of its own.
    expect(within(next).getByRole('button', { name: /Holiday/ })).toBeInTheDocument();
    expect(next).toHaveClass('h-0', 'min-h-full', 'overflow-hidden');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
});
