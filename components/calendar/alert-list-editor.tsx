"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "@/components/icons";
import {
  newAlertRow,
  type AlertAction,
  type AlertRow,
  type AlertUnit,
} from "@/lib/calendar-alerts";

type CalendarT = ReturnType<typeof useTranslations>;

const selectClass =
  "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** "15 minutes before", plus "by email" for email alerts. */
export function formatAlertRowLabel(row: Omit<AlertRow, "id">, t: CalendarT): string {
  let label: string;
  switch (row.unit) {
    case "at_time": label = t("alerts.at_time"); break;
    case "minutes": label = t("alerts.minutes_before", { count: row.value }); break;
    case "hours": label = t("alerts.hours_before", { count: row.value }); break;
    case "days": label = t("alerts.days_before", { count: row.value }); break;
    case "weeks": label = t("alerts.weeks_before", { count: row.value }); break;
  }
  return row.action === "email" ? t("alerts.by_email", { label }) : label;
}

interface AlertListEditorProps {
  rows: AlertRow[];
  onChange: (rows: AlertRow[]) => void;
  /** Alerts the rows can't show (absolute, after the start); saved unchanged. */
  keptCount?: number;
  disabled?: boolean;
}

/**
 * Edits reminders as rows of amount, unit and action (notification or email).
 * Each row is an offset before the start; alerts that don't fit stay with the
 * caller and are only counted here.
 */
export function AlertListEditor({ rows, onChange, keptCount = 0, disabled = false }: AlertListEditorProps) {
  const t = useTranslations("calendar");

  const update = (id: string, patch: Partial<Omit<AlertRow, "id">>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      {rows.length === 0 && keptCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t("alerts.none")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              {row.unit !== "at_time" && (
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={row.value}
                  disabled={disabled}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    update(row.id, { value: Number.isFinite(n) ? Math.max(1, n) : 1 });
                  }}
                  className="w-20"
                  aria-label={t("alerts.amount")}
                />
              )}
              <select
                value={row.unit}
                disabled={disabled}
                onChange={(e) => {
                  const unit = e.target.value as AlertUnit;
                  update(row.id, { unit, value: unit === "at_time" ? 0 : (row.value || 1) });
                }}
                className={`flex-1 min-w-0 ${selectClass}`}
                aria-label={t("alerts.unit")}
              >
                <option value="at_time">{t("alerts.at_time")}</option>
                <option value="minutes">{t("alerts.unit_minutes_before")}</option>
                <option value="hours">{t("alerts.unit_hours_before")}</option>
                <option value="days">{t("alerts.unit_days_before")}</option>
                <option value="weeks">{t("alerts.unit_weeks_before")}</option>
              </select>
              <select
                value={row.action}
                disabled={disabled}
                onChange={(e) => update(row.id, { action: e.target.value as AlertAction })}
                className={selectClass}
                aria-label={t("alerts.action")}
              >
                <option value="display">{t("alerts.action_display")}</option>
                <option value="email">{t("alerts.action_email")}</option>
              </select>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                aria-label={t("alerts.remove")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {keptCount > 0 && (
            <p className="text-xs text-muted-foreground">{t("alerts.kept", { count: keptCount })}</p>
          )}
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, newAlertRow(10, "minutes")])}
        className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        {t("alerts.add")}
      </button>
    </div>
  );
}
