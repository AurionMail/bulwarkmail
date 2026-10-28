import { useEffect, useRef } from "react";
import { historySettled } from "@/hooks/use-close-on-back";

/**
 * Leave guard (R5): an editor with unsaved changes registers here, and the
 * shell's own navigation (the desktop rail, the phone tab bar) asks it
 * before leaving. The editor's in-app exits (Cancel, another item, Back)
 * ask through the editor's own code; this covers what the editor can't see.
 */
export interface LeaveGuard {
  /** True while there is something to lose. Read on every navigation. */
  isDirty: () => boolean;
  /**
   * Ask the user; resolves true when the changes may be dropped. Only ask:
   * the navigation that follows unmounts the editor, and clearing its state
   * first can run its own clean-up (a Back guard's history step) before the
   * navigation lands. The guard isn't asked again for that navigation.
   */
  confirm: () => Promise<boolean>;
}

const guards = new Set<LeaveGuard>();
// Set while the guarded click is replayed, so it isn't stopped again.
let replaying = false;
let asking = false;

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function hasUnsavedChanges(): boolean {
  for (const guard of guards) if (guard.isDirty()) return true;
  return false;
}

/** Asks each editor with changes in turn; true when all of them may be left. */
export async function confirmLeave(): Promise<boolean> {
  for (const guard of [...guards]) {
    if (guard.isDirty() && !(await guard.confirm())) return false;
  }
  return true;
}

/**
 * For the click handler of a link or button that leaves the current app:
 * when an editor has unsaved changes, stops the click, asks, and clicks the
 * same element again once the user lets the changes go. Returns true when
 * it stopped the click; the handler should then do nothing else.
 *
 * `replay` leaves in place of the second click, for an element that is gone
 * by then (an item of a menu that closes).
 */
export function interceptLeave(
  e: { preventDefault(): void; currentTarget: EventTarget | null },
  replay?: () => void,
): boolean {
  if (replaying || !hasUnsavedChanges()) return false;
  e.preventDefault();
  const target = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
  if (asking) return true;
  asking = true;
  void confirmLeave().then(async (leave) => {
    asking = false;
    if (!leave || (!replay && !target)) return;
    // The dialog that asked steps Back off its own history entry as it
    // closes; a navigation started before that lands is undone by it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await historySettled();
    replaying = true;
    try {
      if (replay) replay();
      else target?.click();
    } finally { replaying = false; }
  });
  return true;
}

/** For a way out that isn't a click (a menu command): leaves now, or once the user lets the changes go. */
export function leaveWhenAllowed(leave: () => void): void {
  if (!interceptLeave({ preventDefault() {}, currentTarget: null }, leave)) leave();
}

/** Registers the calling editor's guard while it is mounted. */
export function useLeaveGuard(isDirty: () => boolean, confirm: () => Promise<boolean>): void {
  const latest = useRef({ isDirty, confirm });
  useEffect(() => { latest.current = { isDirty, confirm }; });
  useEffect(() => registerLeaveGuard({
    isDirty: () => latest.current.isDirty(),
    confirm: () => latest.current.confirm(),
  }), []);
}
