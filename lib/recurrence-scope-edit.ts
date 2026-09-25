/**
 * Saving an event editor change made on one occurrence of a series for the
 * part of the series the user picks in the recurrence scope dialog: that
 * occurrence, it and the ones after it, or all of them.
 */

import { differenceInCalendarDays, format, isSameDay, parseISO } from 'date-fns';
import type { RecurrenceEditScope } from '@/components/calendar/recurrence-scope-dialog';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { CalendarEvent } from '@/lib/jmap/types';
import { getEventDisplayEndDate, getEventEndDate, getEventStartDate } from '@/lib/calendar-utils';
import { parseDurationSeconds } from '@/lib/calendar-event-normalization';
import {
  getParticipantList,
  participantFieldsToSave,
  participantsAskedAgain,
  userOrganizes,
  type ParticipantSaveContext,
} from '@/lib/calendar-participants';
import {
  buildFallbackExcludePatch,
  buildFallbackOverridePatch,
  isBrowserExpandedOccurrence,
  isServerRecurrenceInstance,
  overrideContextOf,
  withNewOverrideDetails,
} from '@/lib/recurrence-instances';
import { getEffectiveTimeZone, moveLocalDateTime } from '@/lib/timezone';
import { debug } from '@/lib/debug';

export interface EditorAttendee {
  name: string;
  email: string;
}

/** When an event happens in the editor: display dates, the last day of an all-day event. */
export interface EventWhen {
  allDay: boolean;
  start: Date;
  end: Date;
}

/** What the event editor had when it saved, besides the event data it wrote. */
export interface EventEditorState {
  /** The attendees when the editor opened, and when it saved; the organizer is in neither. */
  initialAttendees: EditorAttendee[];
  attendees: EditorAttendee[];
  when: EventWhen;
  /** The user changed the recurrence rule: a series then happens on other days. */
  ruleChanged?: boolean;
}

/**
 * Whether the editor's dates change when `event` happens: it turns all-day
 * or timed, or its start or end moves - for an all-day event its first or
 * last day. The form's dates and the event's are display dates in the
 * user's zone, compared to the minute the form shows: saving the event in
 * the user's zone instead of its own is no change. Pure, for testing.
 */
export function changesWhen(event: CalendarEvent, next: EventWhen): boolean {
  if (!!event.showWithoutTime !== next.allDay) return true;
  if (next.allDay) {
    return !isSameDay(getEventStartDate(event), next.start)
      || !isSameDay(getEventDisplayEndDate(event), next.end);
  }
  const minute = (date: Date) => Math.floor(date.getTime() / 60_000);
  return minute(getEventStartDate(event)) !== minute(next.start)
    || minute(getEventEndDate(event)) !== minute(next.end);
}

const WHEN_KEYS = ['start', 'duration', 'timeZone', 'showWithoutTime'] as const;
type SeriesWhen = Partial<Pick<CalendarEvent, typeof WHEN_KEYS[number]>>;

/** A display date's wall clock to the minute (the form shows no seconds), as milliseconds. */
function wallClockMinutesMs(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes());
}

/** A LocalDateTime ("YYYY-MM-DDTHH:mm:ss") moved by `ms` on its own wall clock. */
function shiftLocalDateTime(value: string, ms: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return value;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month - 1, day);
  shifted.setUTCHours(hour, minute, second, 0);
  return new Date(shifted.getTime() + ms).toISOString().slice(0, 19);
}

/**
 * When the series happens after the editor moved one of its occurrences:
 * its own start moved by as much as the occurrence was, on its own date and
 * in its own zone; the length only when the editor changed it. Nothing when
 * the occurrence did not move.
 */
function seriesWhen(
  occurrence: CalendarEvent,
  master: CalendarEvent,
  updates: Partial<CalendarEvent>,
  when: EventWhen,
): SeriesWhen {
  if (!changesWhen(occurrence, when)) return {};
  const result: SeriesWhen = {};
  const allDayChanged = !!master.showWithoutTime !== when.allDay;
  const from = getEventStartDate(occurrence);

  if (when.allDay) {
    // The series' first day as the user sees it, moved by the days the
    // occurrence moved.
    const first = !master.showWithoutTime && master.timeZone
      ? moveLocalDateTime(master.start, master.timeZone, getEffectiveTimeZone())
      : master.start;
    const days = differenceInCalendarDays(when.start, from);
    if (days !== 0 || allDayChanged) {
      result.start = `${shiftLocalDateTime(`${first.slice(0, 10)}T00:00:00`, days * 86_400_000).slice(0, 10)}T00:00:00`;
    }
  } else {
    const delta = wallClockMinutesMs(when.start) - wallClockMinutesMs(from);
    if (delta !== 0 || allDayChanged) result.start = shiftLocalDateTime(master.start, delta);
  }

  const seconds = parseDurationSeconds(occurrence.duration ?? master.duration);
  if (allDayChanged || parseDurationSeconds(updates.duration) !== seconds) {
    result.duration = updates.duration;
  }
  if (allDayChanged) {
    result.showWithoutTime = when.allDay;
    result.timeZone = updates.timeZone ?? null;
  }
  return result;
}

/** An event's attendees as the editor lists them: each address once, without the organizer. */
function attendeesOf(event: CalendarEvent): EditorAttendee[] {
  return getParticipantList(event)
    .filter((p) => !p.isOrganizer && p.email.trim())
    .map((p) => ({ name: p.name, email: p.email.trim() }));
}

/**
 * The series' participants after the editor changed one occurrence's: the
 * series' own, with the attendees the user added in the editor or removed
 * from it. Nothing when neither happened and the series does not move -
 * the series keeps its participants and their answers as they are - and
 * nothing when someone else organizes the series.
 */
function seriesParticipants(
  master: CalendarEvent,
  editor: EventEditorState,
  context: ParticipantSaveContext,
): Partial<Pick<CalendarEvent, 'participants' | 'organizerCalendarAddress' | 'replyTo'>> {
  const userEmails = [context.userEmail ?? '', ...(context.userEmails ?? [])].filter(Boolean);
  if (!userOrganizes(master, userEmails)) return {};
  const key = (email: string) => email.trim().toLowerCase();
  const before = new Set(editor.initialAttendees.map((a) => key(a.email)));
  const after = new Set(editor.attendees.map((a) => key(a.email)));
  const added = editor.attendees.filter((a) => !before.has(key(a.email)));
  const removed = new Set([...before].filter((address) => !after.has(address)));
  if (added.length === 0 && removed.size === 0 && !context.rescheduled) return {};
  const attendees = [...attendeesOf(master).filter((a) => !removed.has(key(a.email))), ...added];
  return participantFieldsToSave(master, attendees, context);
}

/**
 * The editor's `updates`, made on `occurrence`, as a change to its whole
 * series `master`.
 *
 * The editor shows one occurrence, so the dates and participants it writes
 * are that occurrence's. Written to the series as they are, the series
 * started on the occurrence's day - the occurrences before it gone, a
 * counted series running longer - and every occurrence got that one
 * occurrence's attendees and answers. The series keeps its own instead:
 * - when it happens, unless the occurrence moved; then the series moves by
 *   as much from its own start (seriesWhen);
 * - its participants and their answers, with the attendees the user added
 *   or removed; when the series moves, the user as its organizer asks the
 *   attendees again (participantFieldsToSave).
 */
export function seriesUpdatesFromOccurrence(
  occurrence: CalendarEvent,
  master: CalendarEvent,
  updates: Partial<CalendarEvent>,
  editor: EventEditorState,
  context: Omit<ParticipantSaveContext, 'rescheduled'>,
): Partial<CalendarEvent> {
  const series: Partial<CalendarEvent> = { ...updates };
  for (const key of [...WHEN_KEYS, 'recurrenceId', 'participants', 'organizerCalendarAddress', 'replyTo'] as const) {
    delete series[key];
  }
  const when = seriesWhen(occurrence, master, updates, editor.when);
  Object.assign(series, when);
  Object.assign(series, seriesParticipants(master, editor, {
    ...context,
    rescheduled: Object.keys(when).length > 0 || !!editor.ruleChanged,
  }));
  return series;
}

/** Options of the calendar store's updateEvent. */
export interface EventUpdateOptions {
  /**
   * The user organizes the event. A change to one occurrence that gives it
   * its own override then reaches the attendees who have answered too
   * (see the calendar store's updateEvent).
   */
  asOrganizer?: boolean;
}

/** What saving an occurrence edit works with: the calendar store's actions and the app's series lookup. */
export interface OccurrenceEditActions {
  client: IJMAPClient;
  updateEvent: (
    client: IJMAPClient,
    id: string,
    updates: Partial<CalendarEvent>,
    sendSchedulingMessages?: boolean,
    options?: EventUpdateOptions,
  ) => Promise<void>;
  createEvent: (client: IJMAPClient, event: Partial<CalendarEvent>, sendSchedulingMessages?: boolean) => Promise<CalendarEvent | null>;
  /** The base event of a series, from one of its occurrences. */
  findMasterEvent: (occurrence: CalendarEvent) => Promise<CalendarEvent | null>;
}

export interface OccurrenceEdit {
  /** The occurrence the editor was opened on. */
  event: CalendarEvent;
  /** What the editor wrote for it. */
  updates: Partial<CalendarEvent>;
  /** What the editor had. Without it the updates go to the series as they are. */
  editor?: EventEditorState;
  sendScheduling?: boolean;
  /** The user's calendar addresses; the first organizes new invitations. */
  userEmails: string[];
  /** A name for an address the event data carries none for. */
  resolveName?: (email: string) => string | undefined;
}

/** A series itself, not one of its occurrences: it has rules and no recurrence id. */
function isSeries(event: CalendarEvent): boolean {
  return (event.recurrenceRules?.length ?? 0) > 0 && !event.recurrenceId;
}

/**
 * `event` as an occurrence of `master`, to override or exclude on it: itself
 * when it is one, the series' first occurrence when it is the series itself.
 * The calendar shows a series it has not expanded - one just created, one
 * opened from a link - as the series, once, at its first occurrence; a
 * change to "this occurrence" of it went to the series and rewrote every
 * occurrence, and deleting it deleted them all.
 */
function asOccurrenceOf(event: CalendarEvent, master: CalendarEvent): CalendarEvent {
  const occurrence = event.recurrenceId
    ? event
    : { ...event, recurrenceId: master.start, recurrenceIdTimeZone: master.timeZone ?? null };
  return overrideContextOf(occurrence, master);
}

/** Whether `event` is `master`'s first occurrence, or the series itself standing for it. */
function isFirstOccurrence(event: CalendarEvent, master: CalendarEvent): boolean {
  if (!event.recurrenceId) return true;
  return parseISO(event.recurrenceId).getTime() === parseISO(master.start).getTime();
}

/**
 * End the series `master` just before `occurrence`. With `sendScheduling`,
 * when the user organizes the series, the attendees are told: Stalwart
 * sends them the shortened series, and their copies end there too (they
 * kept every occurrence before). Resolves to the series' rules as they were
 * and whether the attendees were told, for a rollback.
 */
async function truncateSeries(
  master: CalendarEvent,
  occurrence: CalendarEvent,
  actions: Pick<OccurrenceEditActions, 'client' | 'updateEvent'>,
  scheduling: { sendScheduling?: boolean; userEmails?: string[] } = {},
): Promise<{ originalRules: CalendarEvent['recurrenceRules']; announced: true | undefined }> {
  const originalRules = master.recurrenceRules
    ? JSON.parse(JSON.stringify(master.recurrenceRules))
    : null;
  const occurrenceDate = occurrence.recurrenceId || occurrence.start;
  const untilDate = new Date(occurrenceDate);
  untilDate.setSeconds(untilDate.getSeconds() - 1);
  const until = format(untilDate, "yyyy-MM-dd'T'HH:mm:ss");
  const truncatedRules = (master.recurrenceRules || []).map(rule => ({
    ...rule,
    until,
    count: null,
  }));
  const announced = scheduling.sendScheduling && userOrganizes(master, scheduling.userEmails ?? []) ? true : undefined;
  await actions.updateEvent(actions.client, master.id, { recurrenceRules: truncatedRules }, announced);
  return { originalRules, announced };
}

/**
 * The new series "this and the following occurrences" becomes: the old
 * series' details with the editor's changes, from `occurrence` on. It is a
 * new event with a UID of its own, so every attendee is asked
 * (participantsAskedAgain): Stalwart invites to a new event only attendees
 * who have not answered, and with the answers the old series had, those
 * who had answered never got the new one.
 */
export function followingSeriesData(
  occurrence: CalendarEvent,
  master: CalendarEvent,
  updates: Partial<CalendarEvent>,
  originalRules: CalendarEvent['recurrenceRules'],
): Partial<CalendarEvent> {
  const data: Partial<CalendarEvent> = {
    title: master.title,
    description: master.description,
    duration: master.duration,
    timeZone: master.timeZone,
    calendarIds: { ...master.calendarIds },
    status: master.status,
    freeBusyStatus: master.freeBusyStatus,
    privacy: master.privacy,
    showWithoutTime: master.showWithoutTime,
    recurrenceRules: originalRules,
    ...updates,
    start: updates.start || occurrence.recurrenceId || occurrence.start,
  };
  delete data.id;
  delete data.uid;
  delete data.recurrenceId;
  if (data.participants) {
    data.participants = participantsAskedAgain({
      participants: data.participants,
      organizerCalendarAddress: data.organizerCalendarAddress ?? master.organizerCalendarAddress,
    }) ?? data.participants;
  }
  return data;
}

/**
 * Save the editor's change to one occurrence for `scope`. Resolves to false
 * when the series the occurrence belongs to cannot be found.
 */
export async function saveOccurrenceEdit(
  scope: RecurrenceEditScope,
  edit: OccurrenceEdit,
  actions: OccurrenceEditActions,
): Promise<boolean> {
  const { client, updateEvent, createEvent, findMasterEvent } = actions;
  const { event, updates, sendScheduling } = edit;
  switch (scope) {
    case 'this': {
      if (isServerRecurrenceInstance(event) || isBrowserExpandedOccurrence(event)) {
        // The store writes one occurrence through its own (synthetic) id, or
        // as a recurrence override on the base event it was expanded from.
        const asOrganizer = userOrganizes({
          ...event,
          participants: updates.participants === undefined ? event.participants : updates.participants,
        }, edit.userEmails);
        await updateEvent(client, event.id, updates, sendScheduling, { asOrganizer });
        return true;
      }
      // An override outside an expanded series, or the series itself standing
      // for its first occurrence: override that occurrence on the series,
      // never write it to the series itself.
      const master = await findMasterEvent(event);
      if (master) {
        const occurrence = asOccurrenceOf(event, master);
        const overridePatch = buildFallbackOverridePatch(occurrence, withNewOverrideDetails(occurrence, updates, { seriesKeys: true }));
        if (!overridePatch) return false;
        await updateEvent(client, master.id, overridePatch, sendScheduling);
        return true;
      }
      // One occurrence the server keeps as an event of its own (an
      // invitation to that occurrence alone) is itself what changes.
      if (isSeries(event)) return false;
      await updateEvent(client, event.id, updates, sendScheduling);
      return true;
    }
    case 'this_and_future': {
      const master = await findMasterEvent(event);
      if (!master) return false;
      // From the first occurrence on is the whole series; ended before its
      // first occurrence, the series would be left with none.
      if (isFirstOccurrence(event, master)) return saveOccurrenceEdit('all', edit, actions);
      const { originalRules, announced } = await truncateSeries(master, event, actions, { sendScheduling, userEmails: edit.userEmails });
      const newEventData = followingSeriesData(event, master, updates, originalRules);
      try {
        await createEvent(client, newEventData, sendScheduling);
      } catch (createError) {
        debug.error('Failed to create new series, rolling back master truncation:', createError);
        try {
          await updateEvent(client, master.id, { recurrenceRules: originalRules }, announced);
        } catch (rollbackError) {
          debug.error('Rollback of master event also failed:', rollbackError);
        }
        throw createError;
      }
      return true;
    }
    case 'all': {
      const master = await findMasterEvent(event);
      if (!master) return false;
      let seriesUpdates: Partial<CalendarEvent>;
      if (edit.editor) {
        seriesUpdates = seriesUpdatesFromOccurrence(event, master, updates, edit.editor, {
          userEmail: edit.userEmails[0],
          userEmails: edit.userEmails,
          resolveName: edit.resolveName,
        });
      } else {
        seriesUpdates = { ...updates };
        delete seriesUpdates.recurrenceId;
      }
      await updateEvent(client, master.id, seriesUpdates, sendScheduling);
      return true;
    }
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled scope: ${exhaustive}`);
    }
  }
}

/** What deleting part of a series works with: the calendar store's actions and the app's series lookup. */
export interface OccurrenceDeleteActions extends Pick<OccurrenceEditActions, 'client' | 'updateEvent' | 'findMasterEvent'> {
  deleteEvent: (client: IJMAPClient, id: string, sendSchedulingMessages?: boolean) => Promise<void>;
}

/**
 * Delete the part of a series `scope` names, from `event`, the occurrence
 * the user picked it on. Resolves to false when the series cannot be found.
 */
export async function deleteOccurrence(
  scope: RecurrenceEditScope,
  deletion: { event: CalendarEvent; sendScheduling?: boolean; userEmails: string[] },
  actions: OccurrenceDeleteActions,
): Promise<boolean> {
  const { client, updateEvent, deleteEvent, findMasterEvent } = actions;
  const { event, sendScheduling } = deletion;
  switch (scope) {
    case 'this': {
      if (isServerRecurrenceInstance(event) || isBrowserExpandedOccurrence(event)) {
        // The store destroys a server occurrence, or excludes one the
        // browser expanded on its base event.
        await deleteEvent(client, event.id, sendScheduling);
        return true;
      }
      // An override outside an expanded series, or the series itself standing
      // for its first occurrence: exclude that occurrence on the series,
      // never delete the series.
      const master = await findMasterEvent(event);
      if (master) {
        const excludePatch = buildFallbackExcludePatch(asOccurrenceOf(event, master));
        if (!excludePatch) return false;
        await updateEvent(client, master.id, excludePatch, sendScheduling);
        return true;
      }
      if (isSeries(event)) return false;
      await deleteEvent(client, event.id, sendScheduling);
      return true;
    }
    case 'this_and_future': {
      const master = await findMasterEvent(event);
      if (!master) return false;
      if (isFirstOccurrence(event, master)) {
        await deleteEvent(client, master.id, sendScheduling);
        return true;
      }
      await truncateSeries(master, event, actions, { sendScheduling, userEmails: deletion.userEmails });
      return true;
    }
    case 'all': {
      const master = await findMasterEvent(event);
      if (!master) return false;
      await deleteEvent(client, master.id, sendScheduling);
      return true;
    }
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled scope: ${exhaustive}`);
    }
  }
}
