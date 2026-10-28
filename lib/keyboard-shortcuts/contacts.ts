import type { ShortcutSection } from "./types";

// Contacts' keys (components/contacts/contact-list.tsx handles them).
export const CONTACTS_SECTIONS: readonly ShortcutSection[] = [
  {
    id: "list",
    title: "contacts.shortcuts.list",
    entries: [
      { key: "↓ / ↑", description: "contacts.shortcuts.move" },
      { key: "Home / End", description: "contacts.shortcuts.first_last" },
      { key: "Shift + ↓ / Shift + ↑", description: "contacts.shortcuts.extend" },
      { key: "Enter", description: "contacts.shortcuts.open" },
      { key: "Space", description: "contacts.shortcuts.toggle" },
      { key: "Mod + A", description: "contacts.shortcuts.select_all" },
      { key: "Esc", description: "contacts.shortcuts.clear" },
    ],
  },
  {
    id: "actions",
    title: "contacts.shortcuts.actions",
    entries: [
      { key: "Del / Backspace", description: "contacts.shortcuts.delete" },
      { key: "Shift + F10", description: "contacts.shortcuts.menu" },
    ],
  },
  {
    id: "global",
    title: "shortcuts.sections.global",
    wide: true,
    entries: [{ key: "/", description: "contacts.shortcuts.search" }],
  },
];
