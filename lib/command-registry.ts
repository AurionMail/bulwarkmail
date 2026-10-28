'use client';

// Commands an app adds to the command palette (Ctrl/⌘+K) while it is
// mounted. The palette lists the registered groups above its own global
// commands and searches their labels and keywords. Registering happens in
// the app's component, so the commands come and go with the app.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppIcon } from '@/components/icons';

export interface RegisteredCommand {
  /** Unique within the group. */
  id: string;
  /** Translated, sentence case: "New event", "Go to today". */
  label: string;
  icon?: AppIcon;
  /** More words the search matches, e.g. ["calendar", "appointment"]. Translated too. */
  keywords?: readonly string[];
  /** A key hint shown at the end of the row on devices with a keyboard, in the shortcut notation ("c", "Mod + Enter"). */
  shortcut?: string;
  run: () => void;
  /** Listed only while this returns true, checked each time the palette renders. */
  when?: () => boolean;
}

export interface CommandGroup {
  /** The group heading, translated ("Calendar"). Also identifies the group. */
  label: string;
  commands: readonly RegisteredCommand[];
}

interface Registration {
  token: object;
  read: () => CommandGroup;
}

let registrations: readonly Registration[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => registrations;
const getServerSnapshot = (): readonly Registration[] => [];

/** Register a group; returns the function that removes it again. */
export function registerCommands(read: () => CommandGroup): () => void {
  const entry: Registration = { token: {}, read };
  registrations = [...registrations, entry];
  emit();
  return () => {
    registrations = registrations.filter((r) => r !== entry);
    emit();
  };
}

/**
 * Add a group of commands to the palette while this component is mounted.
 * The group and commands are read when the palette renders, so they can
 * change every render without registering again.
 *
 *   useRegisterCommands(t("sidebar.calendar"), [
 *     { id: "new-event", label: t("calendar.new_event"), icon: Plus, keywords: [t("calendar.event")], shortcut: "c", run: openNewEvent },
 *     { id: "today", label: t("calendar.today"), icon: CalendarEvent, run: goToToday, when: () => view !== "agenda" },
 *   ]);
 */
export function useRegisterCommands(group: string, commands: readonly RegisteredCommand[], enabled = true): void {
  const latest = useRef<CommandGroup>({ label: group, commands });
  useEffect(() => {
    latest.current = { label: group, commands };
  });
  useEffect(() => {
    if (!enabled) return;
    return registerCommands(() => latest.current);
  }, [enabled]);
}

/** The groups registered right now, in the order they were registered, with `when` applied. */
export function useRegisteredCommandGroups(): CommandGroup[] {
  const regs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return regs
    .map((r) => {
      const group = r.read();
      return { label: group.label, commands: group.commands.filter((c) => !c.when || c.when()) };
    })
    .filter((g) => g.commands.length > 0);
}

/** Whether a command matches a search: every word of it in the label or the keywords. */
export function commandMatches(needle: string, label: string, keywords: readonly string[] = []): boolean {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [label, ...keywords].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}
