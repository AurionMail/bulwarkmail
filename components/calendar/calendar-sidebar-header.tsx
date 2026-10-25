"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Plus } from "@/components/icons";

interface CalendarSidebarHeaderProps {
  onCreateEvent: () => void;
  /** Mark the button for the guided tour; off while the toolbar's own "+" is the visible one. */
  tourTarget?: boolean;
}

/**
 * Title row at the top of the calendar sidebar, the same shape as the
 * contacts sidebar header: the app name on the left and "+" on the right.
 */
export function CalendarSidebarHeader({ onCreateEvent, tourTarget = true }: CalendarSidebarHeaderProps) {
  const t = useTranslations("calendar");

  return (
    // Same h-14 box as the mail sidebar's account switcher, so the apps line up;
    // box-content keeps the border outside it, as in mail.
    <div className="px-3 h-14 box-content border-b border-border flex items-center justify-between flex-shrink-0">
      <span className="text-sm font-semibold truncate">{t("title")}</span>
      <Button
        size="icon"
        variant="ghost"
        onClick={onCreateEvent}
        className="h-8 w-8 flex-shrink-0"
        aria-label={t("events.create")}
        title={t("events.create")}
        data-tour={tourTarget ? "create-event-button" : undefined}
      >
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  );
}
