// Plugin/Theme ZIP upload validation, extraction, and manifest parsing

import {
  type ThemeManifest,
  type PluginManifest,
  MAX_THEME_SKIN_BYTES,
} from './plugin-types';
import { sanitizeThemeCSS, sanitizeSkinCSS } from './theme-loader';
import { compileAdvancedTheme, isAdvancedManifest } from './theme-compiler';
import {
  ExtensionPackageError,
  openPackage,
  readEntry,
  readManifest,
  readPluginPackage,
  readText,
  type OpenedPackage,
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

// ─── Manifest Validation ─────────────────────────────────────

function validateBaseManifest(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!manifest.id || typeof manifest.id !== 'string') errors.push('Missing or invalid "id"');
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('Missing or invalid "name"');
  if (!manifest.version || typeof manifest.version !== 'string') errors.push('Missing or invalid "version"');
  if (!manifest.author || typeof manifest.author !== 'string') errors.push('Missing or invalid "author"');
  if (!manifest.type || typeof manifest.type !== 'string') errors.push('Missing or invalid "type"');

  // Validate ID format (alphanumeric + hyphens)
  if (manifest.id && typeof manifest.id === 'string' && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.id)) {
    errors.push('ID must be lowercase alphanumeric with hyphens, min 2 chars');
  }

  return errors;
}

function validateThemeManifest(manifest: Record<string, unknown>): { result: ThemeManifest | null; errors: string[] } {
  const errors = validateBaseManifest(manifest);

  if (manifest.type !== 'theme') {
    errors.push(`Expected type "theme", got "${manifest.type}"`);
  }

  if (!manifest.variants || !Array.isArray(manifest.variants) || manifest.variants.length === 0) {
    errors.push('Missing or empty "variants" array (must be ["light"], ["dark"], or ["light","dark"])');
  } else {
    const valid = manifest.variants.every((v: unknown) => v === 'light' || v === 'dark');
    if (!valid) errors.push('Variants must be "light" or "dark"');
  }

  // ── Theme API v2 fields (all optional) ──
  if (manifest.apiVersion !== undefined && manifest.apiVersion !== 1 && manifest.apiVersion !== 2) {
    errors.push('"apiVersion" must be 1 or 2 if present');
  }
  if (manifest.extends !== undefined && typeof manifest.extends !== 'string') {
    errors.push('"extends" must be a string (the parent theme id)');
  }
  if (manifest.tokens !== undefined && (typeof manifest.tokens !== 'object' || manifest.tokens === null)) {
    errors.push('"tokens" must be an object with optional "common"/"light"/"dark" maps');
  }
  if (manifest.density !== undefined && !['compact', 'normal', 'touch'].includes(manifest.density as string)) {
    errors.push('"density" must be "compact", "normal", or "touch"');
  }
  if (manifest.derive !== undefined && typeof manifest.derive !== 'boolean') {
    errors.push('"derive" must be a boolean');
  }
  if (manifest.radii !== undefined && (typeof manifest.radii !== 'object' || manifest.radii === null)) {
    errors.push('"radii" must be an object');
  }
  if (manifest.typography !== undefined && (typeof manifest.typography !== 'object' || manifest.typography === null)) {
    errors.push('"typography" must be an object');
  }

  if (errors.length > 0) return { result: null, errors };

  return {
    result: manifest as unknown as ThemeManifest,
    errors: [],
  };
}

// ─── ZIP Extraction ──────────────────────────────────────────

/**
 * Extract and validate a theme ZIP file.
 */
export async function extractTheme(file: File): Promise<ThemeExtractionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let pkg: OpenedPackage;
  let manifestData: Record<string, unknown>;
  try {
    pkg = await openPackage(await file.arrayBuffer(), 'theme');
    manifestData = await readManifest(pkg);
  } catch (err) {
    const message = err instanceof ExtensionPackageError ? err.message : 'Invalid ZIP file';
    return { valid: false, errors: [message], warnings: [], manifest: null, css: '', skin: null, preview: null };
  }

  const { result: manifest, errors: manifestErrors } = validateThemeManifest(manifestData);
  errors.push(...manifestErrors);
  if (!manifest) {
    return { valid: false, errors, warnings, manifest: null, css: '', skin: null, preview: null };
  }

  // Read theme.css - required for v1 themes, optional when the manifest
  // declares Theme API v2 fields (tokens/extends/derive/density/radii/typography),
  // since the compiler can produce CSS purely from the manifest.
  const isAdvanced = isAdvancedManifest(manifest);
  let cssText: string | null;
  let skinText: string | null;
  try {
    cssText = await readText(pkg, 'theme.css');
    skinText = await readText(pkg, 'skin.css', MAX_THEME_SKIN_BYTES * 4);
  } catch (err) {
    const message = err instanceof ExtensionPackageError ? err.message : 'Could not read theme files';
    return { valid: false, errors: [message], warnings, manifest, css: '', skin: null, preview: null };
  }

  let userCSS = '';
  if (cssText !== null) {
    userCSS = cssText;
    // Sanitize instead of rejecting, and always: the sanitizer is also what
    // drops rules outside :root and .dark.
    const sanitized = sanitizeThemeCSS(userCSS);
    userCSS = sanitized.css;
    warnings.push(...sanitized.warnings);
  } else if (!isAdvanced) {
    errors.push('Missing theme.css');
    return { valid: false, errors, warnings, manifest, css: '', skin: null, preview: null };
  }

  // Compile advanced tokens into CSS (for v2 manifests). The compiled output
  // is concatenated with any user-supplied theme.css for fine-grained overrides.
  let rawCSS = userCSS;
  if (isAdvanced) {
    const compiled = compileAdvancedTheme(manifest, { userCSS });
    if (compiled.errors.length > 0) {
      errors.push(...compiled.errors);
      return { valid: false, errors, warnings, manifest, css: '', skin: null, preview: null };
    }
    warnings.push(...compiled.warnings);
    rawCSS = compiled.css;

    // Run sanitizer over the final compiled output as a defence-in-depth check.
    const sanitized = sanitizeThemeCSS(rawCSS);
    rawCSS = sanitized.css;
    warnings.push(...sanitized.warnings);
  }

  // Read preview image if present
  let preview: string | null = null;
  if (manifest.preview) {
    try {
      const bytes = await readEntry(pkg, manifest.preview, 512 * 1024);
      if (bytes) preview = await blobToDataUri(new Blob([bytes as BlobPart], { type: previewType(manifest.preview) }));
    } catch {
      warnings.push('Could not read preview image');
    }
  }

  // Read skin.css if present (Theme API v2 only). Skins target real
  // component selectors and bypass the strict :root/.dark selector check -
  // they still go through the dangerous-pattern sanitizer.
  let skin: string | null = null;
  if (skinText !== null) {
    if (!isAdvanced) {
      warnings.push('skin.css ignored - only Theme API v2 manifests can ship a skin');
    } else {
      const rawSkin = skinText;
      if (rawSkin.length > MAX_THEME_SKIN_BYTES) {
        warnings.push(`skin.css exceeds ${Math.round(MAX_THEME_SKIN_BYTES / 1024)} KB and was dropped`);
      } else {
        const sanitized = sanitizeSkinCSS(rawSkin);
        skin = sanitized.css;
        warnings.push(...sanitized.warnings);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest,
    css: rawCSS,
    skin,
    preview,
  };
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
