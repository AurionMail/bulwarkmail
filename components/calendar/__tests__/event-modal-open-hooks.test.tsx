import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import { calendarFormHooks, calendarHooks, clearAllHooks } from '@/lib/plugin-hooks';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// Opening an event for reading fires onCalendarEventOpen once; opening the
// form (a new event, or Edit on an open one) fires onCalendarEventFormOpen.

const calendars = [
  { id: 'cal-1', name: 'Work', isDefault: true, myRights: { mayWriteAll: true, mayWriteOwn: true } },
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

afterEach(() => clearAllHooks());

describe('EventModal open hooks', () => {
  it('reports an existing event opened for reading, and the form when Edit is pressed', async () => {
    const opened = vi.fn();
    const formOpened = vi.fn();
    calendarHooks.onCalendarEventOpen.register('t', opened);
    calendarFormHooks.onCalendarEventFormOpen.register('t', formOpened);

    render(<EventModal event={existing} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(opened.mock.calls[0][0]).toMatchObject({ id: 'e1', title: 'Planning', calendarId: 'cal-1' });
    expect(formOpened).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('events.edit'));
    await waitFor(() => expect(formOpened).toHaveBeenCalledTimes(1));
    expect(formOpened.mock.calls[0][0]).toMatchObject({ title: 'Planning', calendarId: 'cal-1', uid: 'uid-1', isAllDay: false });
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('reports the form for a new event, and no event open', async () => {
    const opened = vi.fn();
    const formOpened = vi.fn();
    calendarHooks.onCalendarEventOpen.register('t', opened);
    calendarFormHooks.onCalendarEventFormOpen.register('t', formOpened);

    render(
      <EventModal
        calendars={calendars}
        defaultDate={new Date('2026-10-12T10:00:00')}
        defaultCalendarId="cal-1"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(formOpened).toHaveBeenCalledTimes(1));
    expect(formOpened.mock.calls[0][0]).toMatchObject({ calendarId: 'cal-1', uid: undefined, attendees: [] });
    expect(opened).not.toHaveBeenCalled();
  });
});
