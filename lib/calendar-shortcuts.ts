// The calendar's single-key shortcuts. A key held with Ctrl, ⌘, Alt or
// Shift is left to the browser (Ctrl+A selects, Alt+← goes back), and
// letters come from the physical key, so they work on any layout (R8).

export type CalendarShortcutAction =
  | "prev"
  | "next"
  | "today"
  | "month"
  | "week"
  | "day"
  | "agenda"
  | "tasks"
  | "new"
  | "search";

const LETTERS: Record<string, CalendarShortcutAction> = {
  t: "today",
  m: "month",
  w: "week",
  d: "day",
  a: "agenda",
  k: "tasks",
  n: "new",
  c: "new",
};

/** The action a key press asks for, or null when it isn't a calendar shortcut. */
export function calendarShortcutAction(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): CalendarShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowLeft") return "prev";
  if (event.key === "ArrowRight") return "next";
  // `/` focuses the search, as in Mail (R8); on any layout, by its key.
  if (event.code === "Slash" || (!event.code && event.key === "/")) return "search";
  const code = event.code;
  const letter = code && code.length === 4 && code.startsWith("Key")
    ? code.charAt(3).toLowerCase()
    : event.key.length === 1 ? event.key.toLowerCase() : "";
  return LETTERS[letter] ?? null;
}
