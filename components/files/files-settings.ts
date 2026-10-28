// Files app preferences: in the synced settings store, edited in Settings > Files
// and by the Files toolbar.

import { useCallback, useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_FILES_SETTINGS, normalizeFilesSettings, type FilesSettings } from "@/lib/files-settings";

export { DEFAULT_FILES_SETTINGS, type FilesSettings };

/** Where older builds kept the Files settings, on this device only. */
export const LEGACY_FILES_SETTINGS_KEY = "files-settings";

/**
 * Moves Files settings an older build left in localStorage into the synced
 * store, once. A choice already made in the synced settings (on this or
 * another device) wins; the old copy is removed either way.
 */
export function migrateLegacyFilesSettings(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LEGACY_FILES_SETTINGS_KEY);
    if (raw === null) return;
    const store = useSettingsStore.getState();
    if (!store.explicitSettings.includes("filesSettings")) {
      store.updateSetting("filesSettings", normalizeFilesSettings(JSON.parse(raw)));
    }
    localStorage.removeItem(LEGACY_FILES_SETTINGS_KEY);
  } catch { /* unreadable: the defaults stand */ }
}

/** The Files settings as they are now, outside React. */
export function getFilesSettings(): FilesSettings {
  migrateLegacyFilesSettings();
  return useSettingsStore.getState().filesSettings;
}

/** The Files settings, and a setter that changes some of them. */
export function useFilesSettings(): [FilesSettings, (patch: Partial<FilesSettings>) => void] {
  useEffect(() => { migrateLegacyFilesSettings(); }, []);
  const settings = useSettingsStore((s) => s.filesSettings);
  const update = useCallback((patch: Partial<FilesSettings>) => {
    const { filesSettings, updateSetting } = useSettingsStore.getState();
    updateSetting("filesSettings", { ...filesSettings, ...patch });
  }, []);
  return [settings, update];
}
