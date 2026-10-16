import { useEffect } from 'react';
import { create } from 'zustand';

interface AdminUnsavedState {
  /** Sections of the admin panel that hold edits nobody has saved yet. */
  dirty: Record<string, true>;
  /** What to run once the admin chooses "Leave" in the prompt. */
  pendingLeave: (() => void) | null;
  /** The one section the pending leave discards, or null for all of them. */
  pendingScope: string | null;
  setDirty: (id: string, dirty: boolean) => void;
  /**
   * Runs `action` now, or asks first when something is unsaved (#1255).
   * With `scope`, only that section's edits count, for leaving a nested
   * panel while the section around it stays mounted.
   */
  requestLeave: (action: () => void, scope?: string) => void;
  confirmLeave: () => void;
  cancelLeave: () => void;
}

export const useAdminUnsavedStore = create<AdminUnsavedState>()((set, get) => ({
  dirty: {},
  pendingLeave: null,
  pendingScope: null,
  setDirty: (id, dirty) => {
    const current = get().dirty;
    if (dirty === (id in current)) return;
    const next = { ...current };
    if (dirty) next[id] = true;
    else delete next[id];
    set({ dirty: next });
  },
  requestLeave: (action, scope) => {
    const dirty = get().dirty;
    if (scope ? !(scope in dirty) : Object.keys(dirty).length === 0) {
      action();
      return;
    }
    set({ pendingLeave: action, pendingScope: scope ?? null });
  },
  confirmLeave: () => {
    const { pendingLeave: action, pendingScope: scope, dirty } = get();
    // Clear first: the action unmounts the dirty section, and a hard
    // navigation must not trip the beforeunload prompt a second time.
    let next: Record<string, true> = {};
    if (scope) {
      next = { ...dirty };
      delete next[scope];
    }
    set({ pendingLeave: null, pendingScope: null, dirty: next });
    action?.();
  },
  cancelLeave: () => set({ pendingLeave: null, pendingScope: null }),
}));

export const selectHasUnsaved = (s: AdminUnsavedState) => Object.keys(s.dirty).length > 0;

/** Reports a section's unsaved edits to the admin layout's leave prompt. */
export function useAdminUnsavedChanges(id: string, dirty: boolean) {
  const setDirty = useAdminUnsavedStore((s) => s.setDirty);
  useEffect(() => {
    setDirty(id, dirty);
  }, [id, dirty, setDirty]);
  useEffect(() => () => setDirty(id, false), [id, setDirty]);
}
