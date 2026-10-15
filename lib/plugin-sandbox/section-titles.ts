// Titles plugins give their sidebar section (api.ui.setSectionTitle). The
// host draws the header itself, like Folders and Tags; without a title it
// shows the plugin's name.

export const MAX_SECTION_TITLE = 40;

const titles = new Map<string, string>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

/** Check and store a title; throws with a message the plugin sees. */
export function setSectionTitle(pluginId: string, value: unknown): void {
  if (value !== null && typeof value !== 'string') throw new Error('ui.setSectionTitle: title must be a string or null');
  // eslint-disable-next-line no-control-regex -- one line of text
  const title = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  if (title.length > MAX_SECTION_TITLE) throw new Error(`ui.setSectionTitle: at most ${MAX_SECTION_TITLE} characters`);
  if (title) titles.set(pluginId, title);
  else titles.delete(pluginId);
  changed();
}

export function sectionTitle(pluginId: string): string | undefined {
  return titles.get(pluginId);
}

export function clearSectionTitle(pluginId: string): void {
  if (titles.delete(pluginId)) changed();
}

export function subscribeSectionTitles(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
