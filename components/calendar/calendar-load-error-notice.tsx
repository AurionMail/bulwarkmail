"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface CalendarLoadErrorNoticeProps {
  onRetry: () => void;
}

/**
 * Shown above the grid while the visible range could not be loaded. The grid
 * keeps the events it had, so this says why they may be out of date.
 */
export function CalendarLoadErrorNotice({ onRetry }: CalendarLoadErrorNoticeProps) {
  const t = useTranslations("calendar.status");
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{t("events_load_failed")}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
