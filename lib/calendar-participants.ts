import type { CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';
import { generateUUID } from '@/lib/utils';
import { jmapErrorType } from '@/lib/jmap/jmap-error';

export interface ParticipantInfo {
  id: string;
  name: string;
  email: string;
  status: CalendarParticipant['participationStatus'];
  isOrganizer: boolean;
}

export interface StatusCounts {
  accepted: number;
  declined: number;
  tentative: number;
  'needs-action': number;
}

/**
 * The limit a refusal names when the server turned an event down for having
 * too many participants, or null for any other failure. Stalwart 1.0
 * enforces maxParticipantsPerEvent on every create and update, answers to
 * invitations included: invalidProperties on `participants`, "An event
 * cannot have more than 20 participants.".
 */
export function participantLimitOf(error: unknown): number | null {
  if (jmapErrorType(error) !== 'invalidProperties') return null;
  const match = /more than (\d+) participants/i.exec(error instanceof Error ? error.message : '');
  return match ? Number(match[1]) : null;
}

/**
 * Check if a participant matches any of the given email addresses.
 * Checks p.email, p.calendarAddress (mailto:...), and p.sendTo values.
 */
function participantMatchesEmail(p: CalendarParticipant, lowerEmails: string[]): boolean {
  if (p.email && lowerEmails.includes(p.email.toLowerCase())) return true;
  if (p.calendarAddress) {
    const addr = p.calendarAddress.replace(/^mailto:/i, '').toLowerCase();
    if (addr && lowerEmails.includes(addr)) return true;
  }
  if (p.sendTo) {
    for (const addr of Object.values(p.sendTo)) {
      const normalized = addr.replace(/^mailto:/i, '').toLowerCase();
      if (normalized && lowerEmails.includes(normalized)) return true;
    }
  }
  return false;
}

/** Best-effort scheduling address for a participant, without the mailto: scheme. */
function getParticipantEmail(p: CalendarParticipant): string {
  if (p.email) return p.email;
  if (p.calendarAddress) return p.calendarAddress.replace(/^mailto:/i, '');
  if (p.sendTo?.imip) return p.sendTo.imip.replace(/^mailto:/i, '');
  return '';
}

/**
 * Collects the event-level organizer calendar address(es).
 * Stalwart conveys the organizer via `organizerCalendarAddress` / `replyTo`
 * rather than a participant `roles.owner` flag, so self-organized events
 * imported from another server have no owner participant to match against.
 */
export function getEventOrganizerEmails(event: CalendarEvent): string[] {
  const emails: string[] = [];
  if (event.organizerCalendarAddress) {
    emails.push(event.organizerCalendarAddress.replace(/^mailto:/i, '').toLowerCase());
  }
  if (event.replyTo) {
    for (const addr of Object.values(event.replyTo)) {
      emails.push(addr.replace(/^mailto:/i, '').toLowerCase());
    }
  }
  return emails.filter(Boolean);
}

/**
 * Merge the user's calendar addresses (identities + account aliases) so
 * isOrganizer() recognises alias-organized events as the user's own. Identities
 * alone carry only one address each, so an alias organizer looked foreign.
 * De-duplicated case-insensitively (first casing kept); blanks dropped.
 */
export function collectUserCalendarAddresses(
  ...groups: Array<ReadonlyArray<string | null | undefined>>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

export function isOrganizer(event: CalendarEvent, userEmails: string[]): boolean {
  if (userEmails.length === 0) return false;
  const lower = userEmails.map(e => e.toLowerCase());

  if (event.participants) {
    const ownerMatch = Object.values(event.participants).some(p =>
      p.roles?.owner && participantMatchesEmail(p, lower)
    );
    if (ownerMatch) return true;
  }

  // Fall back to the event-level organizer address (Stalwart / imported events
  // mark the organizer here instead of via a participant `owner` role).
  return getEventOrganizerEmails(event).some(email => lower.includes(email));
}

export function getUserParticipantId(event: CalendarEvent, userEmails: string[]): string | null {
  if (!event.participants) return null;
  const lower = userEmails.map(e => e.toLowerCase());
  for (const [id, p] of Object.entries(event.participants)) {
    if (participantMatchesEmail(p, lower)) return id;
  }
  return null;
}

export function getUserStatus(
  event: CalendarEvent,
  userEmails: string[]
): CalendarParticipant['participationStatus'] | null {
  if (!event.participants) return null;
  const lower = userEmails.map(e => e.toLowerCase());
  for (const p of Object.values(event.participants)) {
    if (participantMatchesEmail(p, lower)) return p.participationStatus;
  }
  return null;
}

/** When the same address appears in two participant entries, a real RSVP on
 *  either one beats a missing/"needs-action" one — the duplicate is always the
 *  entry that never replied (the needs-action side). Between two real replies
 *  the first-seen entry wins; such conflicts do not occur in practice. */
function betterStatus(
  current: CalendarParticipant['participationStatus'] | undefined,
  incoming: CalendarParticipant['participationStatus'] | undefined
): CalendarParticipant['participationStatus'] {
  if (current === 'needs-action' && incoming && incoming !== 'needs-action') return incoming;
  return current || 'needs-action';
}

export interface ParticipantListOptions {
  /**
   * Fills `ParticipantInfo.name` for participants whose event data carries no
   * name. Stalwart drops the ORGANIZER display name on its iCalendar
   * round-trip, so the organizer (and attendees added by bare address) render
   * as a bare email until the contact card's name is looked up.
   */
  resolveName?: (email: string) => string | undefined;
}

export function getParticipantList(event: CalendarEvent, options?: ParticipantListOptions): ParticipantInfo[] {
  if (!event.participants) return [];
  // Stalwart rebuilds the ORGANIZER line into a participant that carries only
  // `calendarAddress` — no `roles` at all — so `roles.owner` alone would treat
  // the organizer as a plain attendee on every re-read (#731).
  const organizerEmails = getEventOrganizerEmails(event);
  const resolveName = options?.resolveName;

  // The same address can legitimately arrive twice: the organizer as both the
  // ORGANIZER-derived participant and an ATTENDEE line (server-side
  // scheduling, or events written before #731), or an attendee pasted twice.
  // Render each address once by folding later entries into the first-seen
  // one — otherwise every list and count shows a phantom participant.
  const list: ParticipantInfo[] = [];
  const byEmail = new Map<string, ParticipantInfo>();

  for (const [id, p] of Object.entries(event.participants)) {
    const email = getParticipantEmail(p);
    const key = email.trim().toLowerCase();
    const isOrganizer = !!p.roles?.owner || (!!key && organizerEmails.includes(key));

    const existing = key ? byEmail.get(key) : undefined;
    if (existing) {
      if (!existing.name && p.name) existing.name = p.name;
      if (isOrganizer) existing.isOrganizer = true;
      existing.status = betterStatus(existing.status, p.participationStatus);
      continue;
    }

    const entry: ParticipantInfo = {
      id,
      name: p.name || '',
      email,
      status: p.participationStatus || 'needs-action',
      isOrganizer,
    };
    if (key) byEmail.set(key, entry);
    list.push(entry);
  }

  for (const entry of list) {
    if (!entry.name && entry.email && resolveName) {
      entry.name = resolveName(entry.email) || '';
    }
    // The organizer owes no reply to their own invitation; a missing status
    // must not read as "pending" next to the organizer marker. Matches
    // getStatusCounts, which excludes the organizer from pending totals.
    if (entry.isOrganizer && entry.status === 'needs-action') {
      entry.status = 'accepted';
    }
  }
  return list;
}

export function getStatusCounts(event: CalendarEvent): StatusCounts {
  const counts: StatusCounts = { accepted: 0, declined: 0, tentative: 0, 'needs-action': 0 };
  if (!event.participants) return counts;
  const organizerEmails = getEventOrganizerEmails(event);
  for (const p of Object.values(event.participants)) {
    // The organizer is not awaiting their own reply; counting the roles-less
    // participant Stalwart derives from ORGANIZER inflates the pending total.
    const email = getParticipantEmail(p).toLowerCase();
    if (p.roles?.owner || (email && organizerEmails.includes(email))) continue;
    const s = p.participationStatus || 'needs-action';
    if (s in counts) counts[s as keyof StatusCounts]++;
  }
  return counts;
}

export function getParticipantCount(event: CalendarEvent): number {
  if (!event.participants) return 0;
  // Count addresses, not raw entries: an organizer the server emits twice must
  // not inflate the participant badge on event cards and agenda rows. Entries
  // without any address cannot be merged, so they count individually.
  const seen = new Set<string>();
  let count = 0;
  for (const p of Object.values(event.participants)) {
    const key = getParticipantEmail(p).trim().toLowerCase();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    count++;
  }
  return count;
}

type ParticipationStatus = CalendarParticipant['participationStatus'];

/**
 * An event's participants by address (lowercased): the id each was first
 * listed under, and its answer - a real one over a missing or needs-action
 * one when an address is listed twice (see getParticipantList).
 */
function participantsByAddress(
  participants: CalendarEvent['participants'] | null | undefined,
): Map<string, { id: string; status: ParticipationStatus | undefined }> {
  const known = new Map<string, { id: string; status: ParticipationStatus | undefined }>();
  for (const [id, p] of Object.entries(participants ?? {})) {
    const key = getParticipantEmail(p).trim().toLowerCase();
    if (!key) continue;
    const seen = known.get(key);
    if (!seen) known.set(key, { id, status: p.participationStatus });
    else if ((!seen.status || seen.status === 'needs-action') && p.participationStatus) seen.status = p.participationStatus;
  }
  return known;
}

/**
 * The participants an editor save writes: the organizer, then each attendee
 * once. `existing` is the event's current map. An address already in it
 * keeps its participant id and its answer, so a save neither resets the
 * attendees' answers - the user's own on an invitation included - nor leaves
 * a recurrence override pointing at a participant id that is gone. With
 * `askAgain` every attendee but the organizer answers anew (needs-action).
 */
export function buildParticipantMap(
  organizer: { name: string; email: string },
  attendees: { name: string; email: string }[],
  existing?: CalendarEvent['participants'] | null,
  options: { askAgain?: boolean } = {},
): Record<string, Partial<CalendarParticipant>> {
  const participants: Record<string, Partial<CalendarParticipant>> = {};
  const known = participantsByAddress(existing);
  const idFor = (key: string) => {
    const id = known.get(key)?.id;
    return id && !(id in participants) ? id : generateUUID();
  };

  // calendarAddress is the scheduling address in draft-ietf-calext-jscalendarbis
  // (implemented by Stalwart); the RFC 8984 sendTo property is retired there and
  // stored as an inert JSPROP, so it is intentionally not sent.
  const organizerKey = organizer.email.trim().toLowerCase();
  const organizerStatus = known.get(organizerKey)?.status;
  participants[idFor(organizerKey)] = {
    '@type': 'Participant',
    name: organizer.name,
    email: organizer.email,
    calendarAddress: `mailto:${organizer.email}`,
    // owner only, NOT attendee: with roles.attendee set, Stalwart's server-side
    // scheduling emits the organizer as an ATTENDEE line in addition to the
    // ORGANIZER line, so the recipient sees the organizer listed twice.
    roles: { owner: true },
    participationStatus: organizerStatus && organizerStatus !== 'needs-action' ? organizerStatus : 'accepted',
    scheduleAgent: 'server',
    expectReply: false,
    kind: 'individual',
  };

  // The organizer already has an entry above, and an address must not appear
  // twice in the invite list, so drop both cases case-insensitively (#731).
  const seen = new Set<string>([organizerKey]);

  attendees.forEach((a) => {
    const email = a.email.trim();
    const key = email.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);

    participants[idFor(key)] = {
      '@type': 'Participant',
      name: a.name,
      email,
      calendarAddress: `mailto:${email}`,
      roles: { attendee: true },
      participationStatus: (options.askAgain ? undefined : known.get(key)?.status) ?? 'needs-action',
      scheduleAgent: 'server',
      expectReply: true,
      kind: 'individual',
    };
  });

  return participants;
}

/**
 * The event's own organizer: the organizer participant, else the address in
 * `organizerCalendarAddress` or the retired `replyTo`. Null for an event
 * without one.
 */
function eventOrganizer(event: CalendarEvent): { name: string; email: string } | null {
  const participant = getParticipantList(event).find((p) => p.isOrganizer && p.email.trim());
  if (participant) return { name: participant.name, email: participant.email.trim() };
  const address = event.organizerCalendarAddress || Object.values(event.replyTo ?? {})[0];
  const email = address?.replace(/^mailto:/i, '').trim();
  return email ? { name: '', email } : null;
}

export interface ParticipantSaveContext {
  /** The user's first calendar address: the organizer of an event that has none yet. */
  userEmail: string | undefined;
  /** All of the user's calendar addresses (identities, aliases): whether the user organizes the event. */
  userEmails?: string[];
  /** A name for an organizer the event data carries none for (the contact card). */
  resolveName?: (email: string) => string | undefined;
  /** The save changes when the event happens: its start or end instant, or whether it is all-day. */
  rescheduled?: boolean;
}

/**
 * The participant fields an editor save writes.
 *
 * With attendees, the participants are rebuilt around the event's own
 * organizer: an invitation keeps whoever sent it, and a series the exact
 * address it is organized under (Stalwart 1.0 checks it on single
 * occurrences). Only an event without an organizer gets the user, and only
 * then is `organizerCalendarAddress` written: Stalwart derives the
 * iCalendar ORGANIZER solely from it, so without one no invitations go out.
 * Participants that stay keep their id and answer (buildParticipantMap),
 * unless the user as the organizer moves the event: then the other
 * attendees are asked again, as RFC 5546 has an organizer do when an
 * event is rescheduled, and the server's update asks them with
 * needs-action.
 *
 * Without attendees, an event that had participants loses them, its
 * organizer and the retired `replyTo` older releases wrote.
 */
export function participantFieldsToSave(
  event: CalendarEvent | null | undefined,
  attendees: { name: string; email: string }[],
  context: ParticipantSaveContext,
): Partial<Pick<CalendarEvent, 'participants' | 'organizerCalendarAddress' | 'replyTo'>> {
  const { userEmail, resolveName } = context;
  if (attendees.length > 0 && userEmail) {
    const organizer = (event ? eventOrganizer(event) : null) ?? { name: '', email: userEmail };
    const userAddresses = [userEmail, ...(context.userEmails ?? [])].map((address) => address.trim().toLowerCase());
    const askAgain = !!context.rescheduled && userAddresses.includes(organizer.email.toLowerCase());
    const fields: Partial<Pick<CalendarEvent, 'participants' | 'organizerCalendarAddress'>> = {
      participants: buildParticipantMap(
        // A new event has no participants yet, so it would store an empty
        // organizer name.
        { name: organizer.name || resolveName?.(organizer.email) || '', email: organizer.email },
        attendees,
        event?.participants,
        { askAgain },
      ) as Record<string, CalendarParticipant>,
    };
    if (!event?.organizerCalendarAddress) fields.organizerCalendarAddress = `mailto:${organizer.email}`;
    return fields;
  }
  if (attendees.length === 0 && event?.participants && Object.keys(event.participants).length > 0) {
    return {
      participants: null,
      ...(event.replyTo ? { replyTo: null } : {}),
      ...(event.organizerCalendarAddress ? { organizerCalendarAddress: null } : {}),
    };
  }
  return {};
}
