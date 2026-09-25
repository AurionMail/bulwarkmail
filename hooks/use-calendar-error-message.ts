"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { participantLimitOf } from "@/lib/calendar-participants";

/**
 * The message for a failed calendar change: why the server refused it when
 * that is something the user can act on, `fallback` otherwise.
 */
export function useCalendarErrorMessage(): (error: unknown, fallback: string) => string {
  const t = useTranslations("calendar.notifications");
  return useCallback((error: unknown, fallback: string) => {
    const max = participantLimitOf(error);
    return max === null ? fallback : t("participant_limit", { max });
  }, [t]);
}
