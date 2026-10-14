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
}

/** What plugins put on a calendar day. Renders nothing without labels. */
export function PluginDayLabel({ surface, date, className }: PluginDayLabelProps) {
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
          className={cn("pointer-events-none absolute top-0.5 end-0.5 h-1 w-1 rounded-full bg-current opacity-70", className)}
        />
        <span className="sr-only">{marks.map((l) => l.title ?? l.text ?? l.pluginName).join(", ")}</span>
      </>
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
