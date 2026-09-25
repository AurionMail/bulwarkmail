import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// Stalwart 1.0 refuses to save an event with more participants than the
// calendars capability's maxParticipantsPerEvent (20 by default); 0.16
// advertises the same value without enforcing it. The editor warns, and
// still saves. The organizer entry a save adds counts: live on 1.0, 19
// attendees and the organizer are accepted, 20 and the organizer refused.

vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

const calendars = [{
  id: 'cal', name: 'Work', color: '#123456', isDefault: true,
  myRights: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
}] as unknown as Calendar[];

function meeting(attendees: number): CalendarEvent {
  const participants: Record<string, unknown> = {
    org: { '@type': 'Participant', name: 'Me', email: 'me@example.com', calendarAddress: 'mailto:me@example.com', roles: { owner: true }, participationStatus: 'accepted' },
  };
  for (let i = 1; i <= attendees; i++) {
    participants[`a${i}`] = {
      '@type': 'Participant', name: `Guest ${i}`, email: `guest${i}@example.com`,
      calendarAddress: `mailto:guest${i}@example.com`, roles: { attendee: true }, participationStatus: 'needs-action',
    };
  }
  return {
    id: 'e1', uid: 'u1', '@type': 'Event', title: 'All hands', description: '', start: '2026-09-10T10:00:00',
    duration: 'PT1H', timeZone: 'Europe/Berlin', showWithoutTime: false, calendarIds: { cal: true },
    organizerCalendarAddress: 'mailto:me@example.com', participants, alerts: null, recurrenceRules: null,
  } as unknown as CalendarEvent;
}

function editMeeting(attendees: number, maxParticipants: number | null) {
  render(
    <EventModal
      event={meeting(attendees)}
      calendars={calendars}
      onSave={vi.fn()}
      onClose={vi.fn()}
      currentUserEmails={['me@example.com']}
      maxParticipants={maxParticipants}
    />,
  );
  fireEvent.click(screen.getByText('events.edit'));
}

describe('EventModal participant limit', () => {
  it('warns when the attendees and the organizer are more than the server allows on Stalwart 1.0', () => {
    editMeeting(20, 20);
    expect(screen.getByRole('status')).toHaveTextContent('participants.limit_warning');
  });

  it('stays quiet within the limit, the organizer counted', () => {
    editMeeting(19, 20);
    expect(screen.queryByText('participants.limit_warning')).toBeNull();
  });

  it('stays quiet when the server advertises no limit', () => {
    editMeeting(30, null);
    expect(screen.queryByText('participants.limit_warning')).toBeNull();
  });
});
