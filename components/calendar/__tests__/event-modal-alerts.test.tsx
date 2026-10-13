import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent, CalendarEventAlert } from '@/lib/jmap/types';

// #1209: the reminder rows edit the action (notification or email), and
// alerts the rows can't show are saved back unchanged.

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
