import { useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { toJalali, shouldUseJalaliCalendar, JALALI_MONTHS } from "@/lib/jalali-utils";

/**
 * Returns a memoized function that formats a calendar event date in the
 * current locale's own order and names (Intl), e.g.
 *              "Wed, Apr 29, 2026" (en)
 *              "Mi., 29. Apr. 2026" (de)
 *
 * When the Jalali calendar is active (fa locale), the format uses
 * Persian day/month names with the Jalali year, e.g.:
 *              "چهارشنبه, ۹ اردیبهشت ۱۴۰۵"
 */
export function useFormatEventDate(): (date: Date) => string {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const isJalali = shouldUseJalaliCalendar(locale);

  return useCallback(
    (date: Date): string => {
      if (isJalali) {
        const { jy, jm, jd } = toJalali(date);
        // Use Gregorian day-of-week for the translation key (date-fns format)
        const dayOfWeek = format(date, "EEE").toLowerCase();
        const monthName = JALALI_MONTHS[jm - 1];
        return `${t(`days.${dayOfWeek}`)}, ${jd} ${monthName} ${jy}`;
      }

      // A display date: its local fields are the wall-clock to show.
      return date.toLocaleDateString(locale === "en" ? "en-US" : locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [t, isJalali, locale]
  );
}
