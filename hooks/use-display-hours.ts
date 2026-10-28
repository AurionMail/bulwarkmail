import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { displayNow } from "@/lib/timezone";
import { FULL_DAY_HOURS, resolveDisplayHours, type DisplayHours } from "@/lib/calendar-display-range";

/** A time of day to bring into view, e.g. a new event's start; a new nonce asks again. */
export interface RevealTime {
  minutes: number;
  nonce: number;
}

interface UseDisplayHoursOptions {
  scrollRef: RefObject<HTMLElement | null>;
  hourHeight: number;
  revealAt?: RevealTime | null;
}

/**
 * The hours a time grid draws (#1164): the configured range, or the whole
 * day while the user has asked to see it. Owns the grid's vertical scroll
 * position too - it opens an hour before now, and keeps the same hours in
 * place when the range changes underneath it.
 */
export function useDisplayHours({ scrollRef, hourHeight, revealAt }: UseDisplayHoursOptions) {
  const limitHours = useSettingsStore((s) => s.calendarLimitHours);
  const startHour = useSettingsStore((s) => s.calendarDayStartHour);
  const endHour = useSettingsStore((s) => s.calendarDayEndHour);
  const configured = useMemo(
    () => resolveDisplayHours(limitHours, startHour, endHour),
    [limitHours, startHour, endHour],
  );
  const [showAllHours, setShowAllHours] = useState(false);
  const hours: DisplayHours = showAllHours ? FULL_DAY_HOURS : configured;

  const initialHoursRef = useRef(hours);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const { startMinutes, endMinutes } = initialHoursRef.current;
    const now = displayNow();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    // Outside the visible hours (an evening look at a working-hours grid)
    // the day's first hour is more use than its last.
    if (nowMinutes < startMinutes || nowMinutes >= endMinutes) {
      root.scrollTop = 0;
      return;
    }
    root.scrollTop = Math.max(0, ((now.getHours() - 1) * 60 - startMinutes) / 60 * hourHeight);
  }, [scrollRef, hourHeight]);

  const revealRef = useRef<number | null>(null);
  const renderedStartRef = useRef(hours.startMinutes);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const prev = renderedStartRef.current;
    renderedStartRef.current = hours.startMinutes;
    const reveal = revealRef.current;
    revealRef.current = null;
    if (!root) return;
    if (reveal !== null) {
      root.scrollTop = Math.max(0, ((reveal - hours.startMinutes) / 60 - 0.5) * hourHeight);
    } else if (prev !== hours.startMinutes) {
      root.scrollTop = Math.max(0, root.scrollTop + ((prev - hours.startMinutes) / 60) * hourHeight);
    }
  }, [scrollRef, hourHeight, hours.startMinutes]);

  const toggleAllHours = useCallback(() => setShowAllHours((v) => !v), []);
  /** Shows the whole day and scrolls to `minutes` from midnight. */
  const revealMinutes = useCallback((minutes: number) => {
    revealRef.current = minutes;
    setShowAllHours(true);
  }, []);

  // A saved event lands where the user can see it: outside the shown hours
  // the whole day opens, else the grid scrolls to it when it is out of view.
  const revealNonce = revealAt?.nonce;
  useEffect(() => {
    if (!revealAt) return;
    const { minutes } = revealAt;
    if (minutes < hours.startMinutes || minutes >= hours.endMinutes) {
      revealMinutes(minutes);
      return;
    }
    const root = scrollRef.current;
    if (!root) return;
    const top = ((minutes - hours.startMinutes) / 60) * hourHeight;
    if (top < root.scrollTop || top > root.scrollTop + root.clientHeight - 2 * hourHeight) {
      root.scrollTop = Math.max(0, top - hourHeight / 2);
    }
    // Only a new request moves the grid, not a change of range under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  return {
    hours,
    /** Whether a range is configured at all, i.e. the toggle has anything to do. */
    canToggle: configured.restricted,
    configured,
    showAllHours,
    toggleAllHours,
    revealMinutes,
  };
}
