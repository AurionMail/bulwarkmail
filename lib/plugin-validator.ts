// Plugin/Theme ZIP upload validation, extraction, and manifest parsing

import type { ThemeManifest, PluginManifest } from './plugin-types';
import {
  ExtensionPackageError,
  readEntry,
  readPluginPackage,
  readThemePackage,
} from './extension-package';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ThemeExtractionResult extends ValidationResult {
  manifest: ThemeManifest | null;
  css: string;
  /**
   * Optional skin CSS - component-level overrides extracted from `skin.css`.
   * Only populated for Theme API v2 manifests; v1 themes ignore the file.
   */
  skin: string | null;
  preview: string | null; // data URI
}

export interface PluginExtractionResult extends ValidationResult {
  manifest: PluginManifest | null;
  code: string;
  preview: string | null;
}

// ─── ZIP Extraction ──────────────────────────────────────────

/**
 * Extract and validate a theme ZIP file. Same checks as the admin and
 * marketplace installs (see extension-package.ts).
 */
export async function extractTheme(file: File): Promise<ThemeExtractionResult> {
  const result = await readThemePackage(await file.arrayBuffer());
  const { pkg, ...rest } = result;
  let preview: string | null = null;
  if (pkg && result.manifest?.preview) {
    try {
      const bytes = await readEntry(pkg, result.manifest.preview, 512 * 1024);
      if (bytes) preview = await blobToDataUri(new Blob([bytes as BlobPart], { type: previewType(result.manifest.preview) }));
    } catch {
      rest.warnings.push('Could not read preview image');
    }
  }
  return { ...rest, preview };
}

/**
 * Extract and validate a plugin ZIP file. The checks are the ones every
 * server install path runs too (see extension-package.ts).
 */
export async function extractPlugin(file: File): Promise<PluginExtractionResult> {
  let result: Awaited<ReturnType<typeof readPluginPackage>>;
  try {
    result = await readPluginPackage(await file.arrayBuffer(), {
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
    });
  } catch (err) {
    const message = err instanceof ExtensionPackageError ? err.message : 'Invalid ZIP file';
    return { valid: false, errors: message.split('; '), warnings: [], manifest: null, code: '', preview: null };
  }
  const warnings = [...result.warnings];

  let preview: string | null = null;
  const previewName = result.pkg.zip.file(result.pkg.root + 'preview.png') ? 'preview.png'
    : result.pkg.zip.file(result.pkg.root + 'preview.svg') ? 'preview.svg' : null;
  if (previewName) {
    try {
      const bytes = await readEntry(result.pkg, previewName, 512 * 1024);
      if (bytes) {
        const type = previewName.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        preview = await blobToDataUri(new Blob([bytes as BlobPart], { type }));
      }
    } catch {
      warnings.push('Could not read preview image');
    }
  }

  return { valid: true, errors: [], warnings, manifest: result.manifest, code: result.code, preview };
}

function previewType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
