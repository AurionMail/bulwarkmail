// Plugin shortcut dispatcher.
//
// Each enabled plugin declares zero-or-more keyboard shortcuts via its
// `shortcuts` export. On init the host registers each binding here. A single
// window keydown listener matches keys against the active bindings and
// dispatches via `instance.invokeHook('shortcut:<id>', [])`.
//
// The listener ignores events when an editable element has focus, matching
// the convention in `use-keyboard-shortcuts.ts`.

import { isEditableEventTarget } from '@/lib/keyboard';
import type { SandboxInstance } from './host-bridge';

interface Binding {
  pluginId: string;
  shortcutId: string;
  keys: string;          // "Ctrl+Shift+L"
  label: string;
  category?: string;
  invoke: () => Promise<void>;
}

interface NormalisedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

const bindings = new Map<string, Binding>();   // key: `${pluginId}:${shortcutId}`
let listenerInstalled = false;

function normaliseCombo(combo: string): NormalisedCombo | null {
  if (typeof combo !== 'string') return null;
  const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let ctrl = false, shift = false, alt = false, meta = false;
  let key = '';
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') ctrl = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'alt' || lower === 'option') alt = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') meta = true;
    else key = lower;
  }
  if (!key) return null;
  return { ctrl, shift, alt, meta, key };
}

function eventMatches(ev: KeyboardEvent, combo: NormalisedCombo): boolean {
  if (combo.ctrl !== (ev.ctrlKey || ev.metaKey ? ev.ctrlKey : false)) {
    // Treat Ctrl and Cmd as equivalent: a binding declaring Ctrl matches a
    // Cmd press on macOS.
    if (combo.ctrl) {
      if (!(ev.ctrlKey || ev.metaKey)) return false;
    } else if (ev.ctrlKey) return false;
  }
  if (combo.shift !== ev.shiftKey) return false;
  if (combo.alt !== ev.altKey) return false;
  if (!combo.ctrl && combo.meta !== ev.metaKey) return false;
  return ev.key.toLowerCase() === combo.key;
}

function onKeyDown(ev: KeyboardEvent): void {
  if (isEditableEventTarget(ev)) return;
  if (bindings.size === 0) return;
  for (const binding of bindings.values()) {
    const combo = normaliseCombo(binding.keys);
    if (!combo) continue;
    if (eventMatches(ev, combo)) {
      ev.preventDefault();
      ev.stopPropagation();
      void binding.invoke();
      return;
    }
  }
}

function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('keydown', onKeyDown, true);
}

export function registerShortcuts(
  instance: SandboxInstance,
  shortcuts: Array<{ id: string; keys: string; label: string; category?: string }>,
): () => void {
  ensureListener();
  const keys: string[] = [];
  for (const sc of shortcuts) {
    const key = `${instance.pluginId}:${sc.id}`;
    bindings.set(key, {
      pluginId: instance.pluginId,
      shortcutId: sc.id,
      keys: sc.keys,
      label: sc.label,
      category: sc.category,
      invoke: async () => {
        try {
          await instance.invokeHook(`shortcut:${sc.id}`, []);
        } catch {
          /* hook tracker already logs */
        }
      },
    });
    keys.push(key);
  }
  return () => {
    for (const k of keys) bindings.delete(k);
  };
}
