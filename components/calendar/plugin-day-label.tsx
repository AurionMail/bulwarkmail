"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { dayLabelsByDate, subscribeDayLabels, type RegisteredDayLabel } from "@/lib/plugin-sandbox/day-labels";

const NONE: RegisteredDayLabel[] = [];
const EMPTY_MAP = new Map<string, RegisteredDayLabel[]>();

/** The labels plugins put on one day (api.ui.setDayLabels). */
export function useDayLabels(date: string): RegisteredDayLabel[] {
  const byDate = useSyncExternalStore(subscribeDayLabels, dayLabelsByDate, () => EMPTY_MAP);
  return byDate.get(date) ?? NONE;
}

function tooltip(labels: RegisteredDayLabel[]): string {
  return labels.map((l) => `${l.title ?? l.text ?? ""} (${l.pluginName})`.trim()).join("\n");
}

interface PluginDayLabelProps {
  /**
   * calendar-day-header: the label text under a day's name (day, week and
   * month views). mini-calendar-marks: a dot on the day in the small month
   * calendar; the parent must be positioned.
   */
  surface: "calendar-day-header" | "mini-calendar-marks";
  /** YYYY-MM-DD */
  date: string;
  className?: string;
  /**
   * calendar-day-header only: no room for text (the phone month view), so a
   * dot stands for the day's labels; their text is its tooltip and is read
   * out by screen readers.
   */
  compact?: boolean;
}

/** What plugins put on a calendar day. Renders nothing without labels. */
export function PluginDayLabel({ surface, date, className, compact }: PluginDayLabelProps) {
  const labels = useDayLabels(date);

  if (surface === "mini-calendar-marks") {
    const marks = labels.filter((l) => l.dot);
    if (marks.length === 0) return null;
    return (
      <>
        <span
          aria-hidden="true"
          data-plugin-surface="mini-calendar-marks"
          title={tooltip(marks)}
          className={cn("pointer-events-none absolute top-0 end-0 h-1.5 w-1.5 rounded-full bg-muted-foreground ring-1 ring-background", className)}
        />
        <span className="sr-only">{marks.map((l) => l.title ?? l.text ?? l.pluginName).join(", ")}</span>
      </>
    );
  }

  if (compact) {
    const shown = labels.filter((l) => l.text || l.dot);
    if (shown.length === 0) return null;
    return (
      <span
        data-plugin-surface="calendar-day-header"
        data-compact=""
        title={tooltip(shown)}
        className={cn("inline-flex flex-shrink-0", className)}
      >
        <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span className="sr-only">{shown.map((l) => l.text ?? l.title ?? l.pluginName).join(", ")}</span>
      </span>
    );
  }

  const withText = labels.filter((l) => l.text);
  if (withText.length === 0) return null;
  return (
    <div
      data-plugin-surface="calendar-day-header"
      title={tooltip(withText)}
      className={cn("max-w-full truncate text-[10px] leading-tight text-muted-foreground", className)}
    >
      {withText.map((l) => l.text).join(" · ")}
    </div>
  );
}
