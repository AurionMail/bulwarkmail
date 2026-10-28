import type { ShortcutSection } from "./types";

// Files' keys (components/files/file-browser.tsx handles them).
export const FILES_SECTIONS: readonly ShortcutSection[] = [
  {
    id: "list",
    title: "files.shortcuts.list",
    entries: [
      { key: "↓ / ↑", description: "files.shortcuts.move" },
      { key: "← / →", description: "files.shortcuts.move_grid" },
      { key: "Home / End", description: "files.shortcuts.first_last" },
      { key: "Shift + ↓ / Shift + ↑", description: "files.shortcuts.extend" },
      { key: "Enter", description: "files.shortcuts.open" },
      { key: "Space", description: "files.shortcuts.toggle" },
      { key: "Mod + A", description: "files.shortcuts.select_all" },
      { key: "Esc", description: "files.shortcuts.clear" },
      { key: "Alt + ↑", description: "files.shortcuts.up" },
    ],
  },
  {
    id: "actions",
    title: "files.shortcuts.actions",
    entries: [
      { key: "F2", description: "files.shortcuts.rename" },
      { key: "Del / Backspace", description: "files.shortcuts.delete" },
      { key: "Mod + C", description: "files.shortcuts.copy" },
      { key: "Mod + X", description: "files.shortcuts.cut" },
      { key: "Mod + V", description: "files.shortcuts.paste" },
    ],
  },
  {
    id: "global",
    title: "shortcuts.sections.global",
    wide: true,
    entries: [{ key: "/ / Mod + F", description: "files.shortcuts.search" }],
  },
];
