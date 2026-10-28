import type { ShortcutSection } from "./types";

// Calendar's keys (components/calendar/calendar-app.tsx handles them, through
// lib/calendar-shortcuts.ts; the event card and editor handle `e`, Mod + Enter
// and Esc themselves).
export const CALENDAR_SECTIONS: readonly ShortcutSection[] = [
  {
    id: "navigation",
    title: "shortcuts.sections.navigation",
    entries: [
      { key: "←", description: "calendar.shortcuts.previous" },
      { key: "→", description: "calendar.shortcuts.next" },
      { key: "t", description: "calendar.events.go_to_today" },
    ],
  },
  {
    id: "views",
    title: "calendar.shortcuts.views",
    entries: [
      { key: "d", description: "calendar.commands.day" },
      { key: "w", description: "calendar.commands.week" },
      { key: "m", description: "calendar.commands.month" },
      { key: "a", description: "calendar.commands.agenda" },
      { key: "k", description: "calendar.commands.tasks" },
    ],
  },
  {
    id: "actions",
    title: "calendar.shortcuts.actions",
    entries: [
      { key: "↑ ↓ ← →", description: "calendar.shortcuts.move_in_grid" },
      { key: "/", description: "calendar.search.title" },
      { key: "n / c", description: "calendar.shortcuts.new_item" },
      { key: "e", description: "calendar.events.edit" },
      { key: "Mod + Enter", description: "calendar.form.save" },
      { key: "Esc", description: "common.close" },
    ],
  },
  {
    id: "global",
    title: "shortcuts.sections.global",
    wide: true,
    entries: [{ key: "F5 / Mod + R", description: "common.refresh" }],
  },
];
