import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { dayKey } from "@/lib/calendar-scroll-window";
import { calendarShortcutAction } from "@/lib/calendar-shortcuts";
import { displayNow } from "@/lib/timezone";
import type { DisplayHours } from "@/lib/calendar-display-range";

interface UseTimeGridFocusOptions {
  /** The grid's scroll container. */
  rootRef: RefObject<HTMLElement | null>;
  /** The sticky header, which must not cover the focused slot. */
  headerRef: RefObject<HTMLElement | null>;
  /** Width of the sticky hour gutter at the inline start. */
  gutterWidth: number;
  days: Date[];
  hours: DisplayHours;
  /** The day the tab stop starts on while no slot has been focused yet. */
  selectedDate: Date;
  /** Creates an event at the slot (Enter, `n` or `c`). */
  onCreate: (start: Date) => void;
}

export interface TimeGridSlotProps {
  "data-slot": string;
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

const slotId = (key: string, hour: number) => `${key}T${hour}`;

/**
 * Keyboard access to the empty slots of the week and day grids (CAL-13,
 * R8): one tab stop for the whole grid, the arrows move by an hour and a
 * day, Home and End go to the first and last hour, Enter or `n` creates an
 * event there. The month grid works the same way with days.
 */
export function useTimeGridFocus({
  rootRef, headerRef, gutterWidth, days, hours, selectedDate, onCreate,
}: UseTimeGridFocusOptions) {
  const firstHour = hours.startMinutes / 60;
  const lastHour = hours.endMinutes / 60 - 1;
  const [focused, setFocused] = useState<{ key: string; hour: number } | null>(null);

  const dayIndexByKey = useMemo(() => new Map(days.map((day, index) => [dayKey(day), index])), [days]);

  // The slot that takes Tab: the last one focused while it is still drawn,
  // else the selected day (or the first loaded one) at the current hour.
  const tabStop = useMemo(() => {
    if (focused && dayIndexByKey.has(focused.key) && focused.hour >= firstHour && focused.hour <= lastHour) {
      return focused;
    }
    const selectedKey = dayKey(selectedDate);
    const key = dayIndexByKey.has(selectedKey) ? selectedKey : days[0] ? dayKey(days[0]) : selectedKey;
    const hour = Math.min(lastHour, Math.max(firstHour, displayNow().getHours()));
    return { key, hour };
  }, [focused, dayIndexByKey, firstHour, lastHour, selectedDate, days]);

  const focusSlot = useCallback((key: string, hour: number) => {
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-slot="${slotId(key, hour)}"]`);
    if (!el) return;
    setFocused({ key, hour });
    // Clear of the sticky header and hour gutter.
    el.style.scrollMarginTop = `${headerRef.current?.offsetHeight ?? 0}px`;
    el.style.scrollMarginInlineStart = `${gutterWidth}px`;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [rootRef, headerRef, gutterWidth]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>, day: Date, hour: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const key = dayKey(day);
    const index = dayIndexByKey.get(key) ?? 0;
    if (e.key === "Enter" || calendarShortcutAction(e.nativeEvent) === "new") {
      // The slot's own create, not the calendar's `n` at the selected day.
      e.preventDefault();
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      onCreate(start);
      return;
    }
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let nextIndex = index;
    let nextHour = hour;
    switch (e.key) {
      case "ArrowUp": nextHour = hour - 1; break;
      case "ArrowDown": nextHour = hour + 1; break;
      case "ArrowLeft": nextIndex = index + (rtl ? 1 : -1); break;
      case "ArrowRight": nextIndex = index + (rtl ? -1 : 1); break;
      case "Home": nextHour = firstHour; break;
      case "End": nextHour = lastHour; break;
      default: return;
    }
    // The grid's arrows, not the calendar's previous/next period.
    e.preventDefault();
    const nextDay = days[nextIndex];
    if (!nextDay || nextHour < firstHour || nextHour > lastHour) return;
    focusSlot(dayKey(nextDay), nextHour);
  }, [dayIndexByKey, days, firstHour, lastHour, focusSlot, onCreate]);

  /** Props for the slot of `day` at `hour`; pass `enabled: false` on phones. */
  const slotProps = useCallback((day: Date, hour: number, enabled = true): TimeGridSlotProps => {
    const key = dayKey(day);
    return {
      "data-slot": slotId(key, hour),
      tabIndex: enabled && key === tabStop.key && hour === tabStop.hour ? 0 : -1,
      onKeyDown: (e) => handleKeyDown(e, day, hour),
      onFocus: () => setFocused((prev) => (prev?.key === key && prev.hour === hour ? prev : { key, hour })),
    };
  }, [tabStop, handleKeyDown]);

  /** The day of the tab stop: the header's date buttons take Tab on that day only. */
  return { slotProps, tabStopDayKey: tabStop.key };
}
