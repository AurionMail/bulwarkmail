"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface CalendarLoadErrorNoticeProps {
  /** What failed to load: the visible range of events, or the task list. */
  what?: "events" | "tasks";
  onRetry: () => void;
}

/**
 * Shown above the grid (or the task list) while it could not be loaded. It
 * keeps what it had, so this says why that may be out of date.
 */
export function CalendarLoadErrorNotice({ what = "events", onRetry }: CalendarLoadErrorNoticeProps) {
  const t = useTranslations("calendar.status");
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{what === "tasks" ? t("tasks_load_failed") : t("events_load_failed")}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
