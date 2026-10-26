// Plugin loader entrypoint. Delegates to the iframe-based sandbox in
// `lib/plugin-sandbox/`. The legacy blob-URL `import()` path has been
// removed; plugin bundles now run in a null-origin sandbox iframe and
// communicate with the host via postMessage RPC.

import type { InstalledPlugin } from './plugin-types';
import {
  loadSandboxedPlugin,
  unloadSandboxedPlugin,
  activateAllSandboxed,
  deactivateAllSandboxed,
  setSandboxStoreAccessor,
  setupSandboxAutoDisable,
} from './plugin-sandbox/loader';
import { all as allActive, get as getActive } from './plugin-sandbox/registry';

// Re-export so the plugin store can keep the sandbox locale in step via this
// facade, instead of importing lib/plugin-sandbox/loader directly (which would
// also pull the hook buses into consumers' module graphs).
export { setSandboxLocale, forgetSlotOffers } from './plugin-sandbox/loader';
export { snapshotRegionalSettings, type RegionalSnapshot } from './plugin-sandbox/host-bridge';

/**
 * Historically re-published React/ReactDOM on `globalThis` for the blob-import
 * loader, and later also bootstrapped plugin locale sync. Both are obsolete:
 * the sandbox injects React per-iframe, and locale sync now lives where plugin
 * activation is orchestrated (stores/plugin-store -> initializePlugins, via
 * setSandboxLocale). Kept as a no-op for the legacy activateAllPlugins()
 * wrapper and its test.
 */
export function exposePluginExternals(): void {
  /* no-op */
}

// ─── Store accessor (status updates) ──────────────────────────

type StoreAccessor = {
  setPluginStatus: (id: string, status: InstalledPlugin['status'], error?: string) => void;
  markAutoDisabled?: (id: string) => void;
};

export function setPluginStoreAccessor(accessor: StoreAccessor): void {
  setSandboxStoreAccessor(accessor);
}

// ─── Lifecycle (sandbox-backed) ───────────────────────────────

export async function loadPlugin(plugin: InstalledPlugin): Promise<void> {
  if (getActive(plugin.id)) {
    console.warn(`[plugin-loader] "${plugin.id}" is already loaded`);
    return;
  }
  await loadSandboxedPlugin(plugin);
}

export function deactivatePlugin(pluginId: string): void {
  unloadSandboxedPlugin(pluginId);
}

export async function activateAllPlugins(plugins: InstalledPlugin[]): Promise<void> {
  exposePluginExternals();
  await activateAllSandboxed(plugins);
}

export function deactivateAllPlugins(): void {
  deactivateAllSandboxed();
}

export function isPluginActive(pluginId: string): boolean {
  return getActive(pluginId) !== undefined;
}

export function setupAutoDisable(): void {
  setupSandboxAutoDisable();
}

// Re-export for stores/tests that need the active set.
export { allActive as activePlugins };
