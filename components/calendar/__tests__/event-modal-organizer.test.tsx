import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';
import { AUTO_TIME_ZONE } from '@/lib/timezone';
import { useSettingsStore } from '@/stores/settings-store';
import { getEventStartDate } from '@/lib/calendar-utils';

// The editor rewrote the organizer on every save of an event with attendees,
// to the user's first address, and put every attendee back to needs-action.
// An invitation the user saved in their own calendar became the user's, and
// their answer was gone. It now keeps the event's organizer and the answers
// of attendees who stay.

vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true,
  myRights: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
}] as unknown as Calendar[];

// Participants as each version stores them: 0.16.23 drops an attendee's
// roles, 1.0 keeps them.
function participant(version: '0.16' | '1.0', address: string, owner: boolean, status: string) {
  return {
    '@type': 'Participant', calendarAddress: `mailto:${address}`, email: address,
    ...(owner ? { roles: { owner: true } } : version === '1.0' ? { roles: { attendee: true } } : {}),
    participationStatus: status, scheduleAgent: 'server', expectReply: !owner, kind: 'individual',
  };
}

function meeting(organizer: string, participants: Record<string, unknown>): CalendarEvent {
  return {
    id: 'e1', uid: 'u1', '@type': 'Event', title: 'Planning', description: '', start: '2026-10-12T10:00:00',
    duration: 'PT1H', timeZone: 'Europe/Berlin', showWithoutTime: false, calendarIds: { cal: true },
    organizerCalendarAddress: `mailto:${organizer}`, participants, alerts: null, recurrenceRules: null,
  } as unknown as CalendarEvent;
}

async function saveUnchanged(event: CalendarEvent): Promise<Partial<CalendarEvent>> {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <EventModal
      event={event}
      calendars={calendars}
      onSave={onSave}
      onClose={vi.fn()}
      currentUserEmails={['me@example.com']}
    />,
  );
  fireEvent.click(screen.getByText('events.edit'));
  fireEvent.click(screen.getByText('form.save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0] as Partial<CalendarEvent>;
}

describe.each<['0.16' | '1.0']>([['0.16'], ['1.0']])('EventModal organizer and answers on Stalwart %s', (version) => {
  it('keeps the sender of an invitation and the user\'s answer', async () => {
    const data = await saveUnchanged(meeting('boss@example.org', {
      boss: participant(version, 'boss@example.org', true, 'accepted'),
      mine: participant(version, 'me@example.com', false, 'accepted'),
      bob: participant(version, 'bob@example.org', false, 'declined'),
    }));

    expect(data).not.toHaveProperty('organizerCalendarAddress');
    const participants = data.participants as Record<string, CalendarParticipant>;
    expect(Object.keys(participants).sort()).toEqual(['bob', 'boss', 'mine']);
    expect(participants.boss).toMatchObject({ calendarAddress: 'mailto:boss@example.org', roles: { owner: true } });
    expect(participants.mine.participationStatus).toBe('accepted');
    expect(participants.bob.participationStatus).toBe('declined');
  });

  it('keeps the letter case a series is organized under', async () => {
    const data = await saveUnchanged(meeting('ME@Example.com', {
      org: participant(version, 'ME@Example.com', true, 'accepted'),
      guest: participant(version, 'guest@example.net', false, 'tentative'),
    }));

    expect(data).not.toHaveProperty('organizerCalendarAddress');
    const participants = data.participants as Record<string, CalendarParticipant>;
    expect(participants.org.calendarAddress).toBe('mailto:ME@Example.com');
    expect(participants.guest.participationStatus).toBe('tentative');
  });
});

// RFC 5546: when the organizer moves an event, the attendees are asked
// again; every other save keeps their answers. The editor shows and writes
// the event in the user's zone (here Tokyo, UTC+9), which is no move by
// itself.
describe.each<['0.16' | '1.0']>([['0.16'], ['1.0']])('EventModal answers after a move on Stalwart %s', (version) => {
  beforeEach(() => useSettingsStore.setState({ timeZone: 'Asia/Tokyo' }));
  afterEach(() => useSettingsStore.setState({ timeZone: AUTO_TIME_ZONE }));

  // 08:00-09:00 in New York (UTC-4 in October): 21:00-22:00 in Tokyo.
  function inNewYork(organizer: string, participants: Record<string, unknown>): CalendarEvent {
    return {
      ...meeting(organizer, participants),
      start: '2026-10-12T08:00:00', timeZone: 'America/New_York',
      utcStart: '2026-10-12T12:00:00Z', utcEnd: '2026-10-12T13:00:00Z',
    } as CalendarEvent;
  }
  const own = () => inNewYork('me@example.com', {
    org: participant(version, 'me@example.com', true, 'accepted'),
    bob: participant(version, 'bob@example.org', false, 'accepted'),
    carol: participant(version, 'carol@example.org', false, 'declined'),
  });

  async function save(event: CalendarEvent, edit: (container: HTMLElement) => void): Promise<Partial<CalendarEvent>> {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <EventModal event={event} calendars={calendars} onSave={onSave} onClose={vi.fn()} currentUserEmails={['me@example.com']} />,
    );
    fireEvent.click(screen.getByText('events.edit'));
    edit(container);
    fireEvent.click(screen.getByText('form.save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    return onSave.mock.calls[0][0] as Partial<CalendarEvent>;
  }
  const moveStartTo = (time: string) => (container: HTMLElement) => {
    const [startTime] = container.querySelectorAll('input[type="time"]');
    fireEvent.change(startTime, { target: { value: time } });
  };
  const statuses = (data: Partial<CalendarEvent>) => Object.fromEntries(
    Object.entries(data.participants as Record<string, CalendarParticipant>).map(([id, p]) => [id, p.participationStatus]),
  );

  it('asks the attendees again when the user moves their event', async () => {
    const data = await save(own(), moveStartTo('22:00'));

    expect(data.start).toBe('2026-10-12T22:00:00');
    expect(statuses(data)).toEqual({ org: 'accepted', bob: 'needs-action', carol: 'needs-action' });
  });

  it('keeps the answers when only the time zone is rewritten', async () => {
    const data = await save(own(), () => {});

    // Written in the user's zone, at the same instant.
    expect(data).toMatchObject({ start: '2026-10-12T21:00:00', timeZone: 'Asia/Tokyo', duration: 'PT1H' });
    expect(statuses(data)).toEqual({ org: 'accepted', bob: 'accepted', carol: 'declined' });
  });

  it('keeps the answers when the title changes', async () => {
    const data = await save(own(), () => {
      fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Planning, room 2' } });
    });

    expect(data.title).toBe('Planning, room 2');
    expect(statuses(data)).toEqual({ org: 'accepted', bob: 'accepted', carol: 'declined' });
  });

  it('never asks again when the user did not organize the event', async () => {
    const invitation = inNewYork('boss@example.org', {
      boss: participant(version, 'boss@example.org', true, 'accepted'),
      mine: participant(version, 'me@example.com', false, 'accepted'),
      bob: participant(version, 'bob@example.org', false, 'declined'),
    });

    const data = await save(invitation, moveStartTo('22:00'));

    expect(data.start).toBe('2026-10-12T22:00:00');
    expect(statuses(data)).toEqual({ boss: 'accepted', mine: 'accepted', bob: 'declined' });
  });
});

// A save for every occurrence of a series applies what the user changed on
// the occurrence the editor shows (lib/recurrence-scope-edit.ts): the save
// carries the attendees the editor opened and saved with, and its dates.
describe('EventModal editor state on save', () => {
  it('passes the attendees it opened with, those it saved with, and when the event happens', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const event = meeting('me@example.com', {
      org: participant('1.0', 'me@example.com', true, 'accepted'),
      bob: participant('1.0', 'bob@example.org', false, 'accepted'),
    });
    render(<EventModal event={event} calendars={calendars} onSave={onSave} onClose={vi.fn()} currentUserEmails={['me@example.com']} />);
    fireEvent.click(screen.getByText('events.edit'));
    fireEvent.change(screen.getByPlaceholderText('email_placeholder'), { target: { value: 'carol@example.org' } });
    fireEvent.click(screen.getByText('form.save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const editor = onSave.mock.calls[0][2];
    expect(editor.initialAttendees).toEqual([{ name: '', email: 'bob@example.org' }]);
    expect(editor.attendees).toEqual([{ name: '', email: 'bob@example.org' }, { name: '', email: 'carol@example.org' }]);
    expect(editor.when.allDay).toBe(false);
    expect(editor.when.start.getTime()).toBe(getEventStartDate(event).getTime());
    expect(editor.when.end.getTime() - editor.when.start.getTime()).toBe(3_600_000);
  });
});
