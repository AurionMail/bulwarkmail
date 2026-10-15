// Open composers that plugins may work on (api.composer.*).
//
// Each composer registers a handle under a random id while it is open. A
// plugin learns the id only from the composer itself: the click context of
// a composer action (Attach menu, toolbar, Options, Send menu) or the props
// of a composer slot. So a plugin edits the message the user pointed it
// at, never one it found by itself.

import { generateUUID } from '@/lib/utils';

export interface ComposerContent {
  html: string;
  text: string;
}

export interface ComposerAttachment {
  blobId: string;
  name: string;
  type: string;
  size: number;
}

export interface ComposerHandle {
  /** The user's own text, without the signature and the quote. */
  readBody(): ComposerContent;
  readSelection(): ComposerContent & { empty: boolean };
  /** Replace the user's own text. */
  replaceBody(html: string, text: string): boolean;
  /** Replace the selection (or insert at the caret), or with `below` add after it. */
  replaceSelection(html: string, text: string, opts: { below: boolean }): boolean;
  /** Attach a blob the plugin uploaded, through the composer's usual checks. */
  attach(file: ComposerAttachment): Promise<boolean>;
}

const handles = new Map<string, ComposerHandle>();

/** Register an open composer. Returns its id and a function that unregisters it. */
export function registerComposer(handle: ComposerHandle): { id: string; unregister: () => void } {
  const id = generateUUID();
  handles.set(id, handle);
  return { id, unregister: () => { handles.delete(id); } };
}

export function composerHandle(id: unknown): ComposerHandle | null {
  return typeof id === 'string' ? handles.get(id) ?? null : null;
}

/** Test helper. */
export function resetComposers(): void {
  handles.clear();
}
