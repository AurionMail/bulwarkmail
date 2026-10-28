import { addDays, format, startOfDay } from "date-fns";
import type { CalendarEvent, CalendarTask } from "@/lib/jmap/types";
import type { DisplayHours } from "@/lib/calendar-display-range";
import {
  getEventDayBounds,
  getEventStartDate,
  getTimedEventBoundsForDay,
  type CalendarWeekSegment,
} from "@/lib/calendar-utils";

/*
 * Geometry of the printed calendar pages, in millimetres. The page area is
 * the smaller of A4 and US Letter with 12 mm margins, less a little slack so
 * rounding never pushes a page onto a second sheet. app/print.css uses the
 * same numbers.
 */
export const PRINT_PAGE_HEIGHT_MM = { landscape: 184, portrait: 253 } as const;
/** The title block at the top of every calendar page. */
export const PRINT_HEADER_MM = 15;
/** The row of weekday names above the month grid. */
export const PRINT_WEEKDAYS_MM = 6;
/** The day number at the top of a month cell. */
export const PRINT_DAY_HEAD_MM = 5;
/** One line of entries in a month cell or the all-day row. */
export const PRINT_LANE_MM = 4;
/** The weekday and date above a time grid's columns. */
export const PRINT_TIME_GRID_HEAD_MM = 9;
/** One line of text in a time-grid block. */
export const PRINT_TIME_GRID_LINE_MM = 3;

/**
 * Whether a time-grid block of `minutes` has room for less than two lines:
 * it then shows its start and title on one line. `hourSpan` is the minutes
 * the grid covers and `allDayLanes` the lines of its all-day row.
 */
export function isCompactTimeBlock(minutes: number, hourSpan: number, pageHeightMm: number, allDayLanes: number): boolean {
  const allDay = allDayLanes > 0 ? allDayLanes * PRINT_LANE_MM + 1 : 0;
  const gridHeight = pageHeightMm - PRINT_HEADER_MM - PRINT_TIME_GRID_HEAD_MM - allDay;
  return (minutes / hourSpan) * gridHeight < 2 * PRINT_TIME_GRID_LINE_MM;
}

export type PrintPageOrientation = keyof typeof PRINT_PAGE_HEIGHT_MM;

/** Lines of entries a printed month cell has room for, with `weeks` rows on the page. */
export function monthCellCapacity(weeks: number, orientation: PrintPageOrientation): number {
  const gridHeight = PRINT_PAGE_HEIGHT_MM[orientation] - PRINT_HEADER_MM - PRINT_WEEKDAYS_MM;
  const cellHeight = gridHeight / Math.max(1, weeks);
  return Math.max(1, Math.floor((cellHeight - PRINT_DAY_HEAD_MM - 1) / PRINT_LANE_MM));
}

export type MonthPrintItem =
  | { kind: "event"; event: CalendarEvent }
  | { kind: "task"; task: CalendarTask };

/** One drawn entry of a printed week row: `span` days from `startIndex`, on line `lane`. */
export interface MonthPrintChip {
  key: string;
  item: MonthPrintItem;
  startIndex: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** The "+N more" line of a day whose entries do not all fit. */
export interface MonthPrintMore {
  dayIndex: number;
  lane: number;
  count: number;
}

export interface MonthPrintWeekLayout {
  chips: MonthPrintChip[];
  more: MonthPrintMore[];
}

/**
 * Which entries of one week row a printed cell shows. A day keeps all its
 * lines when they fit; one that overflows shows `capacity - 1` and a "+N
 * more" line, so only the days that really overflow lose entries. A span
 * across days of both kinds is cut where it stops being visible.
 *
 * `segments` are the packed event segments of the week (lane = row) and
 * `dayTasks` the tasks due on each day, stacked under that day's events as
 * on screen.
 */
export function layoutMonthWeekForPrint(
  segments: CalendarWeekSegment[],
  dayTasks: CalendarTask[][],
  capacity: number,
): MonthPrintWeekLayout {
  const days = dayTasks.length;
  const covers = (segment: CalendarWeekSegment, day: number) =>
    day >= segment.startIndex && day < segment.startIndex + segment.span;
  const eventLanes = Array.from({ length: days }, (_, day) =>
    segments.reduce((lanes, segment) => (covers(segment, day) ? Math.max(lanes, segment.row + 1) : lanes), 0));
  const limits = eventLanes.map((lanes, day) => (lanes + dayTasks[day].length > capacity ? capacity - 1 : capacity));

  const chips: MonthPrintChip[] = [];
  const hidden = new Array<number>(days).fill(0);
  for (const segment of segments) {
    let runStart = -1;
    const end = segment.startIndex + segment.span;
    for (let day = segment.startIndex; day <= end; day++) {
      const visible = day < end && segment.row < limits[day];
      if (day < end && !visible) hidden[day]++;
      if (visible && runStart === -1) runStart = day;
      if (!visible && runStart !== -1) {
        chips.push({
          key: `${segment.event.id}-${runStart}-${segment.row}`,
          item: { kind: "event", event: segment.event },
          startIndex: runStart,
          span: day - runStart,
          lane: segment.row,
          continuesBefore: runStart > segment.startIndex || segment.continuesBefore,
          continuesAfter: day < end || segment.continuesAfter,
        });
        runStart = -1;
      }
    }
  }
  dayTasks.forEach((tasks, day) => {
    tasks.forEach((task, index) => {
      const lane = eventLanes[day] + index;
      if (lane >= limits[day]) {
        hidden[day]++;
        return;
      }
      chips.push({
        key: `task-${task.id}-${day}`,
        item: { kind: "task", task },
        startIndex: day,
        span: 1,
        lane,
        continuesBefore: false,
        continuesAfter: false,
      });
    });
  });
  const more = hidden.flatMap((count, dayIndex) => (count > 0 ? [{ dayIndex, lane: limits[dayIndex], count }] : []));
  return { chips, more };
}

/**
 * The hours a printed time grid covers: the configured range, widened to
 * whole hours around any event outside it. On screen such events are a
 * click away; on paper they would be lost.
 */
export function printHourRange(hours: DisplayHours, events: CalendarEvent[], days: Date[]): DisplayHours {
  if (!hours.restricted) return hours;
  let start = hours.startMinutes;
  let end = hours.endMinutes;
  for (const day of days) {
    for (const event of events) {
      const bounds = getTimedEventBoundsForDay(event, day);
      if (!bounds || (bounds.startMinutes === 0 && bounds.endMinutes === 1440)) continue;
      const eventEnd = Math.max(bounds.endMinutes, bounds.startMinutes + 1);
      start = Math.min(start, Math.floor(bounds.startMinutes / 60) * 60);
      end = Math.max(end, Math.ceil(eventEnd / 60) * 60);
    }
  }
  if (start === 0 && end === 1440) return { startMinutes: 0, endMinutes: 1440, restricted: false };
  return { startMinutes: start, endMinutes: end, restricted: true };
}

/**
 * A time zone as the header names it: its name in the user's language with
 * the IANA id, e.g. "Central European Time (Europe/Berlin)". The name is the
 * one in force on `at`, so a printout spanning a DST change still names the
 * zone, not one of its offsets.
 */
export function formatPrintTimeZone(timeZone: string, locale: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return name && name !== timeZone ? `${name} (${timeZone})` : timeZone;
  } catch {
    return timeZone;
  }
}

export interface AgendaDay {
  date: Date;
  dateKey: string;
  events: CalendarEvent[];
}

/**
 * Events by the days they cover, in time order; a multi-day event is listed
 * on each of its days. Days outside `range` (inclusive) are left out.
 */
export function groupEventsByDay(events: CalendarEvent[], range?: { start: Date; end: Date }): AgendaDay[] {
  const sorted = [...events].sort((a, b) => getEventStartDate(a).getTime() - getEventStartDate(b).getTime());
  const groups = new Map<string, AgendaDay>();
  const first = range ? startOfDay(range.start) : null;
  const last = range ? startOfDay(range.end) : null;
  for (const event of sorted) {
    let bounds: { startDay: Date; endDay: Date };
    try { bounds = getEventDayBounds(event); } catch { continue; }
    if (isNaN(bounds.startDay.getTime()) || isNaN(bounds.endDay.getTime())) continue;
    for (let day = bounds.startDay; day <= bounds.endDay; day = addDays(day, 1)) {
      if ((first && day < first) || (last && day > last)) continue;
      const key = format(day, "yyyy-MM-dd");
      let group = groups.get(key);
      if (!group) {
        group = { date: day, dateKey: key, events: [] };
        groups.set(key, group);
      }
      group.events.push(event);
    }
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
