import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent, CalendarEventAlert } from '@/lib/jmap/types';

// #1209: the reminder rows edit the action (notification or email), and
// alerts the rows can't show are saved back unchanged.

// Keep the values in the label so "15 minutes" and "1 hour" differ.
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

const calendars = [
  { id: 'cal-1', name: 'Work', isDefault: true, myRights: { mayWriteAll: true, mayWriteOwn: true } },
] as unknown as Calendar[];

const absolute: CalendarEventAlert = {
  '@type': 'Alert',
  trigger: { '@type': 'AbsoluteTrigger', when: '2026-11-19T08:00:00Z' },
  action: 'email',
  acknowledged: null,
  relatedTo: null,
};

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    '@type': 'Event',
    uid: 'uid-1',
    calendarIds: { 'cal-1': true },
    title: 'Review',
    description: '',
    start: '2026-11-20T10:00:00',
    duration: 'PT1H',
    timeZone: 'Europe/Berlin',
    showWithoutTime: false,
    participants: null,
    recurrenceRules: null,
    locations: null,
    virtualLocations: null,
    useDefaultAlerts: false,
    alerts: {
      a15: {
        '@type': 'Alert',
        trigger: { '@type': 'OffsetTrigger', offset: '-PT15M', relativeTo: 'start' },
        action: 'display',
        acknowledged: null,
        relatedTo: null,
      },
      abs: absolute,
    },
    ...overrides,
  } as unknown as CalendarEvent;
}

function renderEditor(event: CalendarEvent) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<EventModal event={event} startInEditMode calendars={calendars} onSave={onSave} onClose={vi.fn()} />);
  return onSave;
}

async function savedData(onSave: ReturnType<typeof vi.fn>): Promise<Partial<CalendarEvent>> {
  fireEvent.click(screen.getByText('form.save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0];
}

describe('EventModal reminder actions', () => {
  it('saves a row switched to email with action email', async () => {
    const onSave = renderEditor(makeEvent());

    fireEvent.change(screen.getByLabelText('alerts.action'), { target: { value: 'email' } });
    const data = await savedData(onSave);

    const offsets = Object.values(data.alerts!).filter((a) => a.trigger['@type'] === 'OffsetTrigger');
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toMatchObject({ action: 'email', trigger: { offset: '-PT15M', relativeTo: 'start' } });
  });

  it('opens an email alert as an email row', () => {
    renderEditor(makeEvent({
      alerts: {
        e: { ...absolute, trigger: { '@type': 'OffsetTrigger', offset: '-PT1H', relativeTo: 'start' } },
      },
    }));
    expect((screen.getByLabelText('alerts.action') as HTMLSelectElement).value).toBe('email');
    expect((screen.getByLabelText('alerts.unit') as HTMLSelectElement).value).toBe('hours');
  });

  it('keeps an absolute alert through a save', async () => {
    const onSave = renderEditor(makeEvent());

    fireEvent.click(screen.getByLabelText('alerts.remove'));
    const data = await savedData(onSave);

    expect(data.alerts).toEqual({ abs: absolute });
  });

  it('keeps an alert after the start instead of turning it into one before', async () => {
    const after: CalendarEventAlert = { ...absolute, action: 'display', trigger: { '@type': 'OffsetTrigger', offset: 'PT10M', relativeTo: 'start' } };
    const onSave = renderEditor(makeEvent({ alerts: { after } }));

    expect(screen.queryByLabelText('alerts.unit')).toBeNull();
    const data = await savedData(onSave);

    expect(data.alerts).toEqual({ after });
  });
});

// Calendar default alerts: a new event uses them; Stalwart copies them into
// the event on create but not when the flag is set on an update.
describe('EventModal calendar default alerts', () => {
  const offset = (o: string, action: CalendarEventAlert['action'] = 'display'): CalendarEventAlert => ({
    '@type': 'Alert',
    trigger: { '@type': 'OffsetTrigger', offset: o, relativeTo: 'start' },
    action,
    acknowledged: null,
    relatedTo: null,
  });
  const work = {
    id: 'cal-1', name: 'Work', isDefault: true, myRights: { mayWriteAll: true, mayWriteOwn: true },
    defaultAlertsWithTime: { w1: offset('-PT15M') },
    defaultAlertsWithoutTime: { w2: offset('-P1D', 'email') },
  };
  const home = {
    id: 'cal-2', name: 'Home', isDefault: false, myRights: { mayWriteAll: true, mayWriteOwn: true },
    defaultAlertsWithTime: { h1: offset('-PT1H', 'email') },
    defaultAlertsWithoutTime: null,
  };
  const withDefaults = [work, home] as unknown as Calendar[];

  function renderNew() {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EventModal calendars={withDefaults} defaultDate={new Date('2026-11-20T10:00:00')} defaultCalendarId="cal-1" onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Sync' } });
    return onSave;
  }

  function renderExisting(event: CalendarEvent, startInEditMode = true) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={event} startInEditMode={startInEditMode} calendars={withDefaults} onSave={onSave} onClose={vi.fn()} />);
    return onSave;
  }

  it('starts a new event on the calendar defaults and saves only the flag', async () => {
    const onSave = renderNew();

    expect(screen.getByText('alerts.calendar_defaults')).toBeTruthy();
    expect(screen.getByText('alerts.minutes_before(15)')).toBeTruthy();
    expect(screen.queryByLabelText('alerts.unit')).toBeNull();

    const data = await savedData(onSave);
    expect(data.useDefaultAlerts).toBe(true);
    expect(data).not.toHaveProperty('alerts');
  });

  it('shows the defaults for the all-day state and the selected calendar', () => {
    renderNew();

    fireEvent.click(screen.getByLabelText('form.all_day_event'));
    expect(screen.getByText('alerts.by_email(alerts.days_before(1))')).toBeTruthy();
    expect(screen.queryByText('alerts.minutes_before(15)')).toBeNull();

    fireEvent.click(screen.getByLabelText('form.all_day_event'));
    fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'cal-2' } });
    expect(screen.getByText('alerts.by_email(alerts.hours_before(1))')).toBeTruthy();
  });

  it('copies the defaults into editable rows on Customize and saves them as custom alerts', async () => {
    const onSave = renderNew();
    fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'cal-2' } });

    fireEvent.click(screen.getByText('alerts.customize'));
    expect((screen.getByLabelText('alerts.unit') as HTMLSelectElement).value).toBe('hours');
    expect((screen.getByLabelText('alerts.action') as HTMLSelectElement).value).toBe('email');
    fireEvent.change(screen.getByLabelText('alerts.amount'), { target: { value: '2' } });

    const data = await savedData(onSave);
    expect(data.useDefaultAlerts).toBe(false);
    expect(Object.values(data.alerts!)).toEqual([
      expect.objectContaining({ action: 'email', trigger: expect.objectContaining({ offset: '-PT2H' }) }),
    ]);
  });

  it('opens a defaults event in defaults mode and keeps the copy the server stored', async () => {
    const stored = { k1: { ...offset('-PT30M'), trigger: { '@type': 'OffsetTrigger', offset: '-PT30M' } } } as unknown as Record<string, CalendarEventAlert>;
    const onSave = renderExisting(makeEvent({ useDefaultAlerts: true, alerts: stored }));

    expect(screen.getByText('alerts.calendar_defaults')).toBeTruthy();
    expect(screen.getByText('alerts.minutes_before(30)')).toBeTruthy();

    const data = await savedData(onSave);
    expect(data.useDefaultAlerts).toBe(true);
    expect(data.alerts).toEqual(stored);
  });

  it('sends the calendar defaults when a custom event goes back to them', async () => {
    const onSave = renderExisting(makeEvent());

    fireEvent.click(screen.getByText('alerts.use_defaults'));
    expect(screen.getByText('alerts.minutes_before(15)')).toBeTruthy();

    const data = await savedData(onSave);
    expect(data.useDefaultAlerts).toBe(true);
    expect(data.alerts).toEqual({ w1: offset('-PT15M') });
  });

  it('takes the current calendar defaults after Customize and Use calendar defaults', async () => {
    const onSave = renderExisting(makeEvent({ useDefaultAlerts: true, alerts: { k1: offset('-PT30M') } }));

    fireEvent.click(screen.getByText('alerts.customize'));
    fireEvent.click(screen.getByText('alerts.use_defaults'));
    expect(screen.getByText('alerts.minutes_before(15)')).toBeTruthy();

    const data = await savedData(onSave);
    expect(data.useDefaultAlerts).toBe(true);
    expect(data.alerts).toEqual({ w1: offset('-PT15M') });
  });

  it('sends the new calendar defaults when a defaults event moves to another calendar', async () => {
    const onSave = renderExisting(makeEvent({ useDefaultAlerts: true, alerts: { k1: offset('-PT15M') } }));

    fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'cal-2' } });
    const data = await savedData(onSave);

    expect(data.useDefaultAlerts).toBe(true);
    expect(data.alerts).toEqual({ h1: offset('-PT1H', 'email') });
  });

  it('labels the effective alerts of a defaults event in view mode', () => {
    renderExisting(makeEvent({ useDefaultAlerts: true, alerts: null }), false);
    expect(screen.getByText('alerts.minutes_before(15)')).toBeTruthy();
  });
});
