// Full pages plugins add to the app (`api.ui.setPages`): each gets an entry
// in the navigation rail and its own route, /apps/<pluginId>/<pageId>, where
// the plugin's `app-page` slot fills the content area.

export interface PluginPage {
  id: string;
  title: string;
  /** Name of a host icon (see components/icons). */
  icon?: string;
}

export interface RegisteredPage extends PluginPage {
  pluginId: string;
  pluginName: string;
}

export const MAX_PAGES_PER_PLUGIN = 3;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ICON_RE = /^[A-Za-z0-9-]{1,40}$/;

export function checkPages(value: unknown): PluginPage[] {
  if (!Array.isArray(value)) throw new Error('pages must be a list');
  if (value.length > MAX_PAGES_PER_PLUGIN) throw new Error(`At most ${MAX_PAGES_PER_PLUGIN} pages`);
  const seen = new Set<string>();
  return value.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`pages[${i}] must be an object`);
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) throw new Error(`pages[${i}].id must be lowercase letters, digits and hyphens`);
    if (seen.has(p.id)) throw new Error(`pages[${i}].id is used twice`);
    seen.add(p.id);
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 40) throw new Error(`pages[${i}].title is required (max 40 characters)`);
    const out: PluginPage = { id: p.id, title: p.title.trim() };
    if (p.icon !== undefined) {
      if (typeof p.icon !== 'string' || !ICON_RE.test(p.icon)) throw new Error(`pages[${i}].icon is invalid`);
      out.icon = p.icon;
    }
    return out;
  });
}

const byPlugin = new Map<string, RegisteredPage[]>();
const listeners = new Set<() => void>();
let snapshot: RegisteredPage[] | null = null;

function changed(): void {
  snapshot = null;
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

export function subscribePages(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setPluginPages(pluginId: string, pluginName: string, pages: PluginPage[]): void {
  if (pages.length === 0) byPlugin.delete(pluginId);
  else byPlugin.set(pluginId, pages.map((p) => ({ ...p, pluginId, pluginName })));
  changed();
}

export function clearPluginPages(pluginId: string): void {
  if (byPlugin.delete(pluginId)) changed();
}

/** Every page, plugins in install order. Stable between changes. */
export function allPages(): RegisteredPage[] {
  if (snapshot) return snapshot;
  snapshot = [...byPlugin.values()].flat();
  return snapshot;
}

export function findPage(pluginId: string, pageId: string): RegisteredPage | null {
  return byPlugin.get(pluginId)?.find((p) => p.id === pageId) ?? null;
}

/** Test helper. */
export function resetPages(): void {
  byPlugin.clear();
  changed();
}
