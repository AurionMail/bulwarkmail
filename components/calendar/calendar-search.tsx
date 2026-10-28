"use client";

import { forwardRef, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Search, X, MapPin, Repeat } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useDisplayDateFormatter } from "@/hooks/use-display-date-formatter";
import { getEventEndDate, getEventStartDate, getPrimaryCalendarId } from "@/lib/calendar-utils";
import { isDeclinedByUser } from "@/lib/calendar-participants";
import { isRecurringEvent } from "@/lib/global-search/providers/calendar";
import { displayNow } from "@/lib/timezone";
import type { Calendar, CalendarEvent } from "@/lib/jmap/types";
import type { CalendarSearchResults as Results } from "@/hooks/use-calendar-event-search";
import { getEventColor } from "./event-card";

const RESULT_SELECTOR = "[data-search-result]";

interface CalendarSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Escape on an empty field, or the phone's close: leave the search. */
  onDismiss?: () => void;
  autoFocus?: boolean;
  className?: string;
}

/** The search box in the calendar toolbar (CAL-16). */
export const CalendarSearchField = forwardRef<HTMLInputElement, CalendarSearchFieldProps>(
  function CalendarSearchField({ value, onChange, onDismiss, autoFocus, className }, ref) {
    const t = useTranslations("calendar");
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        // Escape clears the search first, then leaves the field (R8).
        e.preventDefault();
        e.stopPropagation();
        if (value) onChange("");
        else { e.currentTarget.blur(); onDismiss?.(); }
      } else if (e.key === "ArrowDown") {
        const first = document.querySelector<HTMLElement>(RESULT_SELECTOR);
        if (first) { e.preventDefault(); first.focus(); }
      }
    };
    return (
      <div className={cn("relative", className)} role="search">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        {/* type="search" keeps password managers out of it, as in Mail. */}
        <Input
          ref={ref}
          type="search"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("search.title")}
          aria-label={t("search.title")}
          autoComplete="off"
          data-calendar-search
          className={cn(
            "h-8 ps-8 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
            value && "pe-8",
          )}
        />
        {value && (
          <IconButton
            label={t("search.clear")}
            size="icon-sm"
            className="absolute end-0 top-1/2 -translate-y-1/2"
            onClick={() => onChange("")}
          >
            <X />
          </IconButton>
        )}
      </div>
    );
  },
);

interface CalendarSearchResultsProps {
  query: string;
  results: Results;
  calendars: Calendar[];
  timeFormat?: "12h" | "24h";
  currentUserEmails?: string[];
  onSelectEvent: (event: CalendarEvent, anchorRect: DOMRect) => void;
  onContextMenuEvent?: (e: React.MouseEvent, event: CalendarEvent) => void;
}

/** The events a calendar search found, upcoming first, then past ones. */
export function CalendarSearchResults({
  query, results, calendars, timeFormat = "24h", currentUserEmails, onSelectEvent, onContextMenuEvent,
}: CalendarSearchResultsProps) {
  const t = useTranslations("calendar");
  const intlFormatter = useDisplayDateFormatter();
  const listRef = useRef<HTMLDivElement>(null);
  const calendarMap = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const { upcoming, past, searching } = results;
  const count = upcoming.length + past.length;
  const thisYear = displayNow().getFullYear();

  const formatTime = (date: Date) => timeFormat === "12h"
    ? intlFormatter.dateTime(date, { hour: "numeric", minute: "2-digit", hour12: true })
    : format(date, "HH:mm");

  // ↑/↓ walk the list, ↑ on the first row goes back to the search box (R8).
  const handleRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(RESULT_SELECTOR) ?? []);
    const index = rows.indexOf(e.currentTarget);
    const next = rows[index + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
    else if (e.key === "ArrowUp") document.querySelector<HTMLElement>("[data-calendar-search]")?.focus();
  };

  const renderRow = (ev: CalendarEvent) => {
    const calId = getPrimaryCalendarId(ev);
    const calendar = calId ? calendarMap.get(calId) : undefined;
    const color = getEventColor(ev, calendar);
    const start = getEventStartDate(ev);
    const end = getEventEndDate(ev);
    const isInactive = ev.status === "cancelled" || isDeclinedByUser(ev, currentUserEmails);
    const locationName = ev.locations ? Object.values(ev.locations)[0]?.name : null;
    const meta = [locationName, calendar?.name].filter(Boolean).join(" · ");
    // A series the server found by its first occurrence.
    const repeats = !ev.recurrenceId && isRecurringEvent(ev);
    const sameYear = start.getFullYear() === thisYear;
    const title = ev.title || t("events.no_title");
    return (
      <button
        key={ev.id}
        type="button"
        data-search-result
        onClick={(e) => onSelectEvent(ev, e.currentTarget.getBoundingClientRect())}
        onContextMenu={onContextMenuEvent ? (e) => onContextMenuEvent(e, ev) : undefined}
        onKeyDown={handleRowKeyDown}
        className="w-full flex items-start gap-3 px-2 sm:px-4 rounded-md hover:bg-muted/60 focus-visible:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring transition-colors text-start"
        style={{ paddingBlock: "var(--density-item-py)" }}
      >
        <span className="w-24 sm:w-32 flex-shrink-0 text-sm leading-tight">
          <span className="block text-foreground">
            {intlFormatter.dateTime(start, sameYear
              ? { weekday: "short", month: "short", day: "numeric" }
              : { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {ev.showWithoutTime ? t("events.all_day") : `${formatTime(start)} – ${formatTime(end)}`}
          </span>
        </span>
        <span
          className="w-[9px] h-[9px] mt-[5.5px] rounded-full flex-shrink-0"
          style={isInactive ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="flex-1 min-w-0">
          <span className={cn("block text-sm font-medium truncate", isInactive && "line-through text-muted-foreground")} title={title}>
            {title}
          </span>
          {(meta || repeats) && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 min-w-0">
              {locationName && <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
              {meta && <span className="truncate" title={meta}>{meta}</span>}
              {repeats && (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <Repeat className="w-3 h-3" aria-hidden="true" />
                  {t("search.repeats")}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    );
  };

  const section = (id: string, label: string, events: CalendarEvent[]) => events.length > 0 && (
    <section aria-labelledby={id} className="py-1">
      <h2 id={id} className="px-2 sm:px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      <div className="px-1 sm:px-2">{events.map(renderRow)}</div>
    </section>
  );

  return (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto" data-testid="calendar-search-results">
      <p className="sr-only" role="status" aria-live="polite">
        {searching && count === 0 ? "" : t("search.results", { count })}
      </p>
      {count === 0 && searching && (
        <div className="flex justify-center p-8"><Spinner /></div>
      )}
      {count === 0 && !searching && (
        <EmptyState
          icon={Search}
          title={t("search.no_results", { query: query.trim() })}
          description={t("search.no_results_hint")}
        />
      )}
      {section("calendar-search-upcoming", t("search.upcoming"), upcoming)}
      {section("calendar-search-past", t("search.past"), past)}
      {count > 0 && searching && (
        <div className="flex justify-center py-3"><Spinner size="sm" /></div>
      )}
    </div>
  );
}
