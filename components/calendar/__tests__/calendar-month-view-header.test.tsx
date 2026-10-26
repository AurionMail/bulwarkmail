import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CalendarMonthView } from '../calendar-month-view';
import type { Calendar } from '@/lib/jmap/types';

const calendars = [{ id: 'cal-1', name: 'Work', color: '#123456' }] as unknown as Calendar[];

describe('CalendarMonthView header layout', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the day headers inside the scrollable container as a sticky row', () => {
    render(
      <CalendarMonthView
        focus={{ date: new Date(2026, 8, 9), nonce: 0 }}
        windowKey="month:2026-09-09"
        rangeStart={new Date(2026, 7, 31)}
        rangeEnd={new Date(2026, 9, 4)}
        selectedDate={new Date(2026, 8, 9)}
        events={[]}
        calendars={calendars}
        onSelectDate={vi.fn()}
        onSelectEvent={vi.fn()}
      />,
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);

    // The header row should be sticky top-0 and inside the scroll container
    const headerRow = headers[0].closest<HTMLElement>('[role="row"]');
    expect(headerRow).not.toBeNull();
    expect(headerRow).toHaveClass('sticky', 'top-0', 'z-50', 'bg-background');

    // The header row must be a child of the scroll container
    const scroller = document.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(headerRow);

    // Grid cells should also be inside the same scroll container
    const gridCells = screen.getAllByRole('gridcell');
    expect(gridCells.length).toBeGreaterThan(0);
    expect(scroller).toContainElement(gridCells[0]);
  });
});
