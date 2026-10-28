"use client";

import { useEffect, useMemo, useState } from "react";
import { matchesTerms, parseSearchQuery } from "@/lib/global-search/query-parser";
import { calendarFilterFor, eventFields } from "@/lib/global-search/providers/calendar";
import { getEventEndDate, getEventStartDate } from "@/lib/calendar-utils";
import { displayNow } from "@/lib/timezone";
import { debug } from "@/lib/debug";
import type { CalendarEvent } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";

const SERVER_LIMIT = 100;
const DEBOUNCE_MS = 250;

export interface CalendarSearchResults {
  /** Events still to come (or going on), soonest first. */
  upcoming: CalendarEvent[];
  /** Events that are over, latest first. */
  past: CalendarEvent[];
  /** Waiting for the server's answer. */
  searching: boolean;
}

// One row per event: a series found as loaded occurrences and as the
// server's base event shows once. An occurrence renamed on its own gets a
// row of its own, so the series still shows under its own title: the next
// occurrence being the renamed one hid the series.
const seriesKey = (event: CalendarEvent) =>
  `${event.accountId ?? ""} ${event.uid || event.originalId || event.id} ${event.title ?? ""}`;

/**
 * Searches the user's events by title, place, description and participants
 * (CAL-16). The events already loaded answer at once; the server's
 * CalendarEvent/query `text` filter then adds the rest of the calendar. A
 * server that can't answer leaves the loaded matches.
 */
export function useCalendarEventSearch(
  query: string,
  client: IJMAPClient | null,
  loadedEvents: CalendarEvent[],
): CalendarSearchResults | null {
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const active = parsed.terms.length > 0;
  const text = parsed.text;

  const local = useMemo(
    () => (active ? loadedEvents.filter((event) => matchesTerms(parsed.terms, eventFields(event))) : []),
    [active, loadedEvents, parsed],
  );

  const [remote, setRemote] = useState<{ text: string; events: CalendarEvent[] | null } | null>(null);
  useEffect(() => {
    if (!active || !client) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Inside the chain, so a client that can't query at all lands in catch.
      Promise.resolve().then(() => client.queryAllCalendarEvents(
        calendarFilterFor(parsed),
        [{ property: "start", isAscending: false }],
        SERVER_LIMIT,
        { signal: controller.signal },
      )).then((events) => {
        if (!controller.signal.aborted) setRemote({ text, events });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        debug.warn("calendar", "Event search on the server failed; showing loaded events only", error);
        setRemote({ text, events: null });
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, client, parsed, text]);

  return useMemo(() => {
    if (!active) return null;
    const answered = remote?.text === text ? remote : null;
    const now = displayNow().getTime();
    const ends = (event: CalendarEvent) => getEventEndDate(event).getTime();
    const starts = (event: CalendarEvent) => getEventStartDate(event).getTime();

    // Of a series' loaded occurrences, the next one to come, else the last.
    const bySeries = new Map<string, CalendarEvent>();
    for (const event of local) {
      const key = seriesKey(event);
      const kept = bySeries.get(key);
      if (!kept) { bySeries.set(key, event); continue; }
      const keptUpcoming = ends(kept) >= now;
      const upcoming = ends(event) >= now;
      if (upcoming && (!keptUpcoming || starts(event) < starts(kept))) bySeries.set(key, event);
      else if (!upcoming && !keptUpcoming && starts(event) > starts(kept)) bySeries.set(key, event);
    }
    for (const event of answered?.events ?? []) {
      if (typeof event.start !== "string" || !event.start) continue;
      const key = seriesKey(event);
      if (!bySeries.has(key)) bySeries.set(key, event);
    }

    const upcoming: CalendarEvent[] = [];
    const past: CalendarEvent[] = [];
    for (const event of bySeries.values()) {
      if (Number.isNaN(starts(event))) continue;
      (ends(event) >= now ? upcoming : past).push(event);
    }
    upcoming.sort((a, b) => starts(a) - starts(b));
    past.sort((a, b) => starts(b) - starts(a));
    return { upcoming, past, searching: !!client && !answered };
  }, [active, local, remote, text, client]);
}
