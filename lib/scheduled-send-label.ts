import { formatDateTime } from '@/lib/utils';

/**
 * The release time of a scheduled message, for lists and banners.
 *
 * The server can land a second before the minute the user picked (08:00
 * showed as 07:59), so the time is rounded to the nearest minute. A message
 * that is not due today also shows its date; a bare "07:59" for tomorrow
 * morning read like a time that had already passed.
 */
export function formatScheduledSendAt(
  sendAt: string,
  timeFormat: '12h' | '24h',
  now: Date = new Date(),
): string {
  const ms = Date.parse(sendAt);
  if (!Number.isFinite(ms)) return sendAt;
  const rounded = new Date(Math.round(ms / 60_000) * 60_000);
  const sameDay = rounded.toDateString() === now.toDateString();
  return sameDay
    ? formatDateTime(rounded, timeFormat)
    : formatDateTime(rounded, timeFormat, { weekday: 'short', month: 'short', day: 'numeric' });
}
