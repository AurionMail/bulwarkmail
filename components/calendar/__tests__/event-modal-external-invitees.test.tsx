import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventModal } from '../event-modal';
import { ExternalRecipientConfirmHost } from '@/components/email/external-recipient-confirm';
import type { Calendar, CalendarEvent, Identity } from '@/lib/jmap/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { useExternalRecipientConfirmStore } from '@/stores/external-recipient-confirm-store';
import { resetSendPipeline } from '@/lib/outgoing/send-pipeline';

// Saving a meeting sends its invitations (the server does, on save), so a
// newly invited person outside the organisation gets the same confirm as a
// message. People already invited aren't asked about again.

vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true,
  myRights: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
}] as unknown as Calendar[];

const party = (address: string, owner: boolean) => ({
  '@type': 'Participant', calendarAddress: `mailto:${address}`, email: address,
  roles: owner ? { owner: true } : { attendee: true },
  participationStatus: owner ? 'accepted' : 'needs-action', scheduleAgent: 'server', expectReply: !owner, kind: 'individual',
});

// The user's meeting, already sent to a partner outside.
const meeting = {
  id: 'e1', uid: 'u1', '@type': 'Event', title: 'Planning', description: '', start: '2026-10-12T10:00:00',
  duration: 'PT1H', timeZone: 'Europe/Berlin', showWithoutTime: false, calendarIds: { cal: true },
  organizerCalendarAddress: 'mailto:me@example.com', alerts: null, recurrenceRules: null,
  participants: { org: party('me@example.com', true), partner: party('partner@partner.example', false) },
} as unknown as CalendarEvent;

function setWarning(on: boolean) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, recipientWarning: on } },
    },
  });
}

beforeEach(() => {
  setWarning(true);
  useAuthStore.setState({ identities: [{ id: 'i1', name: 'Me', email: 'me@example.com' } as unknown as Identity] });
  useContactStore.setState({ contacts: [], contactsLoaded: true });
  useExternalRecipientConfirmStore.setState({ pending: null, queue: [] });
});
afterEach(() => {
  cleanup();
  resetSendPipeline();
});

function editWithNewInvitee(onSave: ReturnType<typeof vi.fn>, invitee: string) {
  render(
    <>
      <EventModal event={meeting} calendars={calendars} onSave={onSave as never} onClose={vi.fn()} currentUserEmails={["me@example.com"]} />
      <ExternalRecipientConfirmHost />
    </>,
  );
  fireEvent.click(screen.getByText('events.edit'));
  fireEvent.change(screen.getByPlaceholderText('email_placeholder'), { target: { value: invitee } });
  fireEvent.click(screen.getByText('form.save'));
}

describe('invitations to people outside the organisation', () => {
  it('asks about the new external invitee only, and Back saves nothing', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    editWithNewInvitee(onSave, 'org-dave@org-two.test');
    await waitFor(() => expect(useExternalRecipientConfirmStore.getState().pending).not.toBeNull());
    expect(useExternalRecipientConfirmStore.getState().pending?.recipients.map((r) => r.address)).toEqual(['org-dave@org-two.test']);
    act(() => useExternalRecipientConfirmStore.getState().answer(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves and sends after Send anyway', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    editWithNewInvitee(onSave, 'org-dave@org-two.test');
    await waitFor(() => expect(useExternalRecipientConfirmStore.getState().pending).not.toBeNull());
    act(() => useExternalRecipientConfirmStore.getState().answer(true));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toBe(true);
  });

  it('saves without asking for an internal invitee or with the warning off', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    editWithNewInvitee(onSave, 'colleague@example.com');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    cleanup();
    setWarning(false);
    const second = vi.fn().mockResolvedValue(undefined);
    editWithNewInvitee(second, 'org-dave@org-two.test');
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(useExternalRecipientConfirmStore.getState().pending).toBeNull();
  });
});
