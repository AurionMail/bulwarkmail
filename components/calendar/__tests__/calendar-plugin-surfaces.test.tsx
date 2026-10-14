import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import { EventDetailPopover } from '../event-detail-popover';
import { CalendarWeekView } from '../calendar-week-view';
import { CalendarDayView } from '../calendar-day-view';
import { CalendarMonthView } from '../calendar-month-view';
import { MiniCalendar } from '../mini-calendar';
import { resetDayLabels, setDayLabels } from '@/lib/plugin-sandbox/day-labels';
import { clearSlotOffers, framePropsOf, offerSlots } from '@/components/plugins/__tests__/fake-slot-offer';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// Plugin surfaces in the calendar: a section in an event's details and in
// its form, and the labels and dots plugins put on days.

vi.mock('@/components/plugins/plugin-iframe-slot', () => import('@/components/plugins/__tests__/fake-slot-offer'));

const calendars = [
  { id: 'cal-1', name: 'Work', color: '#123456', isDefault: true, myRights: { mayWriteAll: true, mayWriteOwn: true } },
] as unknown as Calendar[];

const existing = {
  id: 'e1',
  uid: 'uid-1',
  title: 'Planning',
  start: '2026-10-12T10:00:00',
  duration: 'PT1H',
  timeZone: null,
  showWithoutTime: false,
  calendarIds: { 'cal-1': true },
} as unknown as CalendarEvent;

afterEach(() => {
  cleanup();
  clearSlotOffers();
  resetDayLabels();
});

describe('calendar-event-detail', () => {
  it('shows the event in the detail popover', () => {
    offerSlots('p1', ['calendar-event-detail']);
    render(
      <EventDetailPopover
        event={existing}
        calendar={calendars[0]}
        anchorRect={new DOMRect(100, 100, 50, 20)}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onClose={vi.fn()}
        onSaveNote={vi.fn()}
      />,
    );

    const frame = screen.getByTestId('plugin-frame-calendar-event-detail');
    expect(framePropsOf(frame).event).toMatchObject({ id: 'e1', uid: 'uid-1', title: 'Planning', calendarId: 'cal-1' });
  });

  it('moves the popover up when the plugin section makes it taller, so it stays in the window', () => {
    let resize: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resize = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    let height = 200;
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? height : 0;
    });
    try {
      offerSlots('p1', ['calendar-event-detail']);
      // An event at 14:00 in the week view of a 1280x800 window.
      render(
        <EventDetailPopover
          event={existing}
          calendar={calendars[0]}
          anchorRect={new DOMRect(600, 520, 120, 60)}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
          onClose={vi.fn()}
          onSaveNote={vi.fn()}
        />,
      );
      const popover = screen.getByRole('dialog');
      expect(popover.style.top).toBe('520px');

      height = 420;
      act(() => resize?.());
      expect(popover.style.top).toBe(`${800 - 420 - 12}px`);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('shows the event in the modal view, and not in the form', () => {
    offerSlots('p1', ['calendar-event-detail']);
    render(<EventModal event={existing} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(framePropsOf(screen.getByTestId('plugin-frame-calendar-event-detail')).event).toMatchObject({ id: 'e1', title: 'Planning' });

    fireEvent.click(screen.getByText('events.edit'));
    expect(screen.queryByTestId('plugin-frame-calendar-event-detail')).toBeNull();
  });

  it('renders nothing when no plugin offers it', () => {
    render(<EventModal event={existing} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(document.querySelector('[data-plugin-slot]')).toBeNull();
  });
});

describe('calendar-event-form', () => {
  it('hands the plugin the form state of an edited event and follows the fields', async () => {
    offerSlots('p1', ['calendar-event-form']);
    render(<EventModal event={existing} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('plugin-frame-calendar-event-form')).toBeNull();

    fireEvent.click(screen.getByText('events.edit'));
    const frame = screen.getByTestId('plugin-frame-calendar-event-form');
    expect(framePropsOf(frame).event).toMatchObject({
      id: 'e1', uid: 'uid-1', calendarId: 'cal-1', title: 'Planning', start: '2026-10-12T10:00:00', duration: 'PT1H', isAllDay: false,
    });

    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Planning v2' } });
    await waitFor(() => {
      expect(framePropsOf(screen.getByTestId('plugin-frame-calendar-event-form')).event).toMatchObject({ title: 'Planning v2' });
    });
  });

  it('gives a new event an empty id', () => {
    offerSlots('p1', ['calendar-event-form']);
    render(
      <EventModal
        calendars={calendars}
        defaultDate={new Date('2026-10-12T10:00:00')}
        defaultEndDate={new Date('2026-10-12T11:30:00')}
        defaultCalendarId="cal-1"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(framePropsOf(screen.getByTestId('plugin-frame-calendar-event-form')).event).toMatchObject({
      id: '', uid: '', calendarId: 'cal-1', duration: 'PT1H30M', participants: [],
    });
  });

  it('renders nothing when no plugin offers it', () => {
    render(<EventModal calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(document.querySelector('[data-plugin-slot]')).toBeNull();
  });
});

describe('calendar-day-header and mini-calendar-marks', () => {
  const week = {
    focus: { date: new Date(2026, 8, 9), nonce: 0 },
    windowKey: 'week:2026-09-07',
    rangeStart: new Date(2026, 8, 7),
    rangeEnd: new Date(2026, 8, 13),
    selectedDate: new Date(2026, 8, 9),
    events: [],
    calendars,
    onSelectDate: vi.fn(),
    onSelectEvent: vi.fn(),
    onCreateAtTime: vi.fn(),
  };

  function headerOf(dayKey: string): HTMLElement {
    const header = document.querySelector<HTMLElement>(`[role="columnheader"][data-day="${dayKey}"], [data-day="${dayKey}"] [role="columnheader"]`);
    if (!header) throw new Error(`no header for ${dayKey}`);
    return header;
  }

  it('puts a label under the day name in the week view', () => {
    render(<CalendarWeekView {...week} />);
    expect(document.querySelector('[data-plugin-surface="calendar-day-header"]')).toBeNull();

    act(() => setDayLabels('hol', 'Holidays', [{ date: '2026-09-09', text: 'Feast day', title: 'A feast' }]));

    const label = headerOf('2026-09-09').querySelector<HTMLElement>('[data-plugin-surface="calendar-day-header"]');
    expect(label).toHaveTextContent('Feast day');
    expect(label?.title).toBe('A feast (Holidays)');
    expect(headerOf('2026-09-10').querySelector('[data-plugin-surface="calendar-day-header"]')).toBeNull();
  });

  it('puts a label under the day name in the day view', () => {
    act(() => setDayLabels('hol', 'Holidays', [{ date: '2026-09-09', text: 'Feast day' }]));
    render(<CalendarDayView {...week} windowKey="day:2026-09-09" rangeStart={new Date(2026, 8, 9)} rangeEnd={new Date(2026, 8, 9)} />);

    expect(headerOf('2026-09-09').querySelector('[data-plugin-surface="calendar-day-header"]')).toHaveTextContent('Feast day');
  });

  it('shows the label in the month cell header on desktop only', () => {
    act(() => setDayLabels('hol', 'Holidays', [{ date: '2026-09-09', text: 'Feast day' }]));
    const month = { ...week, windowKey: 'month:2026-09-09', rangeStart: new Date(2026, 7, 31), rangeEnd: new Date(2026, 9, 4) };
    const { unmount } = render(<CalendarMonthView {...month} />);

    const labels = document.querySelectorAll('[data-plugin-surface="calendar-day-header"]');
    expect(labels).toHaveLength(1);
    expect(labels[0].closest('[role="gridcell"]')?.getAttribute('aria-label')).toMatch(/9/);
    unmount();

    render(<CalendarMonthView {...month} isMobile />);
    expect(document.querySelector('[data-plugin-surface="calendar-day-header"]')).toBeNull();
  });

  it('marks days with a dot in the small month calendar', () => {
    render(
      <MiniCalendar selectedDate={new Date(2026, 8, 1)} displayMonth={new Date(2026, 8, 1)} onSelectDate={vi.fn()} onChangeMonth={vi.fn()} />,
    );
    expect(document.querySelector('[data-plugin-surface="mini-calendar-marks"]')).toBeNull();

    act(() => setDayLabels('hol', 'Holidays', [
      { date: '2026-09-09', dot: true, title: 'A feast' },
      { date: '2026-09-10', text: 'Text only' },
    ]));

    const dots = document.querySelectorAll('[data-plugin-surface="mini-calendar-marks"]');
    expect(dots).toHaveLength(1);
    expect(dots[0].closest('button')).toHaveTextContent('9');
    expect(dots[0].closest('button')).toHaveTextContent('A feast');
  });
});
