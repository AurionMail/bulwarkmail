import type { ShortcutSection } from "./types";

// settings's keys for the help modal: one or more sections like MAIL_SECTIONS
// in ./mail.ts. Empty sections are not drawn, and an app without any rows
// gets no tab.
export const SETTINGS_SECTIONS: readonly ShortcutSection[] = [];
