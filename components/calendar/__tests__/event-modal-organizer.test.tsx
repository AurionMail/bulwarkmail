import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';

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
