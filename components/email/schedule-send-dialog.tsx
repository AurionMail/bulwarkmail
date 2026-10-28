"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings-store";
import { schedulePresets } from "@/lib/schedule-presets";
import { cn, formatDateTime } from "@/lib/utils";

/** `date` as a datetime-local input value, in local time. */
export function formatLocalDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleValue(): string {
  const tomorrowAtEight = new Date();
  tomorrowAtEight.setDate(tomorrowAtEight.getDate() + 1);
  tomorrowAtEight.setHours(8, 0, 0, 0);
  return formatLocalDateTimeInput(tomorrowAtEight);
}

export interface ScheduleSendDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The chosen time as an ISO string, once it is in the future and allowed. */
  onSchedule: (delayedUntil: string) => void;
  /** Whether the server can hold a message for later at all. */
  supported: boolean;
  /** The server's limit in seconds (maxDelayedSend); 0 when it sets none. */
  maxDelayedSend?: number;
  /** "Schedule send" in the composer, "Reschedule" for a scheduled message. */
  title?: string;
  /** The primary button. Defaults to the title. */
  confirmLabel?: string;
  /** Start from this time instead of tomorrow 8:00, e.g. the current schedule. */
  initialDate?: Date;
  /** The presets and the button wait, e.g. while the composer sends. */
  disabled?: boolean;
}

/**
 * Pick when a message goes out: the usual times in one click, or any other
 * in the field. The composer's Schedule send and the Scheduled folder's
 * Reschedule share it.
 */
export function ScheduleSendDialog({
  isOpen,
  onClose,
  onSchedule,
  supported,
  maxDelayedSend = 0,
  title,
  confirmLabel,
  initialDate,
  disabled = false,
}: ScheduleSendDialogProps) {
  const t = useTranslations("email_composer");
  const tCommon = useTranslations("common");
  const timeFormat = useSettingsStore((state) => state.timeFormat);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const initialTime = initialDate?.getTime();

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialTime && initialTime > Date.now()
      ? formatLocalDateTimeInput(new Date(initialTime))
      : defaultScheduleValue());
    setError("");
  }, [isOpen, initialTime]);

  const validate = (candidate: string): string | null => {
    if (!supported) return t("schedule_send_unsupported");
    if (!candidate) return t("schedule_send_required");
    const time = new Date(candidate).getTime();
    if (!Number.isFinite(time)) return t("schedule_send_invalid");
    if (time <= Date.now()) return t("schedule_send_future");
    if (maxDelayedSend > 0 && time > Date.now() + maxDelayedSend * 1000) return t("schedule_send_too_late");
    return null;
  };

  const scheduleAt = (candidate: string) => {
    const problem = validate(candidate);
    if (problem) {
      setError(problem);
      return;
    }
    onSchedule(new Date(candidate).toISOString());
  };

  const heading = title ?? t("schedule_send");

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={heading}
      description={t("schedule_send_description")}
      initialFocus={fieldRef}
      onSubmit={(e) => {
        e.preventDefault();
        scheduleAt(value);
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>{tCommon("cancel")}</Button>
          <Button type="submit" disabled={disabled}>{confirmLabel ?? heading}</Button>
        </>
      }
    >
      {/* One click for the usual times; the field below takes any other. */}
      <div className="mb-4 flex flex-col">
        {schedulePresets().map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => scheduleAt(formatLocalDateTimeInput(preset.date))}
            disabled={disabled}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 max-md:min-h-11 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <span>{t(`schedule_preset.${preset.key}`)}</span>
            <span className="text-muted-foreground">
              {formatDateTime(preset.date, timeFormat, { weekday: "short", month: "short", day: "numeric" })}
            </span>
          </button>
        ))}
      </div>
      <Input
        ref={fieldRef}
        type="datetime-local"
        aria-label={heading}
        aria-invalid={!!error}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      />
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
