"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Check } from "@/components/icons";
import type { Calendar, CalendarTask } from "@/lib/jmap/types";

interface CalendarTaskChipProps {
  task: CalendarTask;
  calendar?: Calendar;
  onToggleComplete?: (task: CalendarTask) => void;
  onSelect?: (task: CalendarTask) => void;
  /** A full row for a finger: 44px tall, a bigger circle with a 44px hit area (phone day view). */
  touch?: boolean;
  /** False for a day scrolled out of view: Tab skips it. */
  tabbable?: boolean;
  className?: string;
}

/**
 * A task on its due day in the month and week grids (#1107). The circle
 * toggles completion; the title opens the task in the editor.
 */
export function CalendarTaskChip({ task, calendar, onToggleComplete, onSelect, touch = false, tabbable = true, className }: CalendarTaskChipProps) {
  const t = useTranslations("calendar");
  const isCompleted = task.progress === "completed";
  const color = calendar?.color || "#3b82f6";
  const title = task.title || t("tasks.no_title");

  return (
    <div
      data-calendar-task={task.id}
      className={cn(
        "start-bar ps-[3px] rounded font-medium flex items-center overflow-hidden",
        touch ? "min-h-11 text-xs" : "h-full text-[10px]",
        className,
      )}
      style={{ backgroundColor: `${color}20`, "--start-bar": color } as React.CSSProperties}
    >
      <button
        type="button"
        tabIndex={tabbable ? undefined : -1}
        onClick={(e) => { e.stopPropagation(); onToggleComplete?.(task); }}
        className={cn(
          "group flex items-center flex-shrink-0",
          touch ? "self-stretch w-11 justify-center" : "h-full ps-1 pe-0.5",
        )}
        aria-label={isCompleted ? t("tasks.mark_incomplete") : t("tasks.mark_complete")}
      >
        <span
          className={cn(
            "rounded-full border flex items-center justify-center",
            touch ? "w-4 h-4" : "w-2.5 h-2.5",
            isCompleted ? "bg-success border-success text-success-foreground" : "group-hover:bg-background",
          )}
          style={isCompleted ? undefined : { borderColor: color }}
        >
          {isCompleted && <Check className={touch ? "h-3 w-3" : "h-2 w-2"} />}
        </span>
      </button>
      <button
        type="button"
        tabIndex={tabbable ? undefined : -1}
        onClick={(e) => { e.stopPropagation(); onSelect?.(task); }}
        className={cn(
          "flex-1 min-w-0 truncate text-start pe-1 hover:opacity-80",
          touch ? "self-stretch" : "h-full",
          isCompleted && "line-through text-muted-foreground",
        )}
        title={title}
        dir="auto"
      >
        {title}
      </button>
    </div>
  );
}
