// The Files app's preferences, part of the synced settings (settings store
// key `filesSettings`), so Export, Reset and other devices include them.

export interface FilesSettings {
  defaultViewMode: "list" | "grid";
  showIcons: boolean;
  coloredIcons: boolean;
  defaultSortKey: "name" | "size" | "modified";
  defaultSortDir: "asc" | "desc";
  showHiddenFiles: boolean;
  showThumbnails: boolean;
}

export const DEFAULT_FILES_SETTINGS: FilesSettings = {
  defaultViewMode: "list",
  showIcons: true,
  coloredIcons: true,
  defaultSortKey: "name",
  defaultSortDir: "asc",
  showHiddenFiles: false,
  showThumbnails: true,
};

const CHOICES: { [K in keyof FilesSettings]: readonly FilesSettings[K][] } = {
  defaultViewMode: ["list", "grid"],
  showIcons: [true, false],
  coloredIcons: [true, false],
  defaultSortKey: ["name", "size", "modified"],
  defaultSortDir: ["asc", "desc"],
  showHiddenFiles: [true, false],
  showThumbnails: [true, false],
};

/** Files settings from an import, the server or an old build: known keys with valid values, the rest default. */
export function normalizeFilesSettings(value: unknown): FilesSettings {
  const out: FilesSettings = { ...DEFAULT_FILES_SETTINGS };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(CHOICES) as (keyof FilesSettings)[]) {
    if ((CHOICES[key] as readonly unknown[]).includes(record[key])) {
      (out as unknown as Record<string, unknown>)[key] = record[key];
    }
  }
  return out;
}
