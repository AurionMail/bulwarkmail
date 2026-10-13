import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth, getClientIP } from '@/lib/admin/session';
import { auditLog } from '@/lib/admin/audit';
import { logger } from '@/lib/logger';
import {
  getThemeRegistry,
  saveTheme,
  deleteTheme as removeTheme,
  type ServerTheme,
} from '@/lib/admin/plugin-registry';
import { forgetExtensionInPolicy } from '@/lib/admin/extension-cleanup';

import { ExtensionPackageError, openPackage, readManifest, readText, type OpenedPackage } from '@/lib/extension-package';
import { sanitizeThemeCSS } from '@/lib/theme-loader';

/**
 * GET /api/admin/themes - List all admin-managed themes
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const registry = await getThemeRegistry();
    return NextResponse.json(registry.themes, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    logger.error('Theme list error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/themes - Upload and install a theme ZIP
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const ip = getClientIP(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    let pkg: OpenedPackage;
    let manifest: Record<string, unknown>;
    try {
      pkg = await openPackage(await file.arrayBuffer(), 'theme');
      manifest = await readManifest(pkg);
    } catch (err) {
      if (err instanceof ExtensionPackageError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    // Validate manifest
    const errors: string[] = [];
    if (!manifest.id || typeof manifest.id !== 'string') errors.push('Missing or invalid "id"');
    if (!manifest.name || typeof manifest.name !== 'string') errors.push('Missing or invalid "name"');
    if (!manifest.version || typeof manifest.version !== 'string') errors.push('Missing or invalid "version"');
    if (!manifest.author || typeof manifest.author !== 'string') errors.push('Missing or invalid "author"');

    if (manifest.type !== 'theme') {
      errors.push(`Expected type "theme", got "${manifest.type}"`);
    }

    if (manifest.id && typeof manifest.id === 'string' && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.id)) {
      errors.push('ID must be lowercase alphanumeric with hyphens, min 2 chars');
    }

    if (!manifest.variants || !Array.isArray(manifest.variants) || manifest.variants.length === 0) {
      errors.push('Missing or empty "variants" array');
    } else {
      const valid = manifest.variants.every((v: unknown) => v === 'light' || v === 'dark');
      if (!valid) errors.push('Variants must be "light" or "dark"');
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
    }

    // Read theme.css
    let css: string | null;
    try {
      css = await readText(pkg, 'theme.css');
    } catch (err) {
      if (err instanceof ExtensionPackageError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
    if (css === null) {
      return NextResponse.json({ error: 'Missing theme.css' }, { status: 400 });
    }

    // Sanitize unconditionally: the safety check is advisory, and the
    // sanitizer is also what drops rules outside :root and .dark.
    const warnings: string[] = [];
    const sanitized = sanitizeThemeCSS(css);
    css = sanitized.css;
    warnings.push(...sanitized.warnings);

    const now = new Date().toISOString();
    const theme: ServerTheme = {
      id: manifest.id as string,
      name: manifest.name as string,
      version: manifest.version as string,
      author: manifest.author as string,
      description: (manifest.description as string) || '',
      variants: manifest.variants as string[],
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };

    await saveTheme(theme, css);
    await auditLog('theme.install', { id: theme.id, name: theme.name, version: theme.version, warnings }, ip);

    return NextResponse.json({ theme, warnings });
  } catch (error) {
    logger.error('Theme install error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/themes - Update theme metadata (enable/disable)
 * Body: { id: string, enabled: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const ip = getClientIP(request);
    const { id, enabled, forceEnabled } = await request.json();

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing theme id' }, { status: 400 });
    }
    if (typeof enabled !== 'boolean' && typeof forceEnabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled or forceEnabled must be a boolean' }, { status: 400 });
    }

    const updates: { enabled?: boolean; forceEnabled?: boolean } = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (typeof forceEnabled === 'boolean') updates.forceEnabled = forceEnabled;

    const { updateThemeMeta } = await import('@/lib/admin/plugin-registry');
    const updated = await updateThemeMeta(id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
    }

    await auditLog('theme.update', { id, ...updates }, ip);
    return NextResponse.json({ theme: updated });
  } catch (error) {
    logger.error('Theme update error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/themes - Remove a theme
 * Body: { id: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const ip = getClientIP(request);
    const { id } = await request.json();

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing theme id' }, { status: 400 });
    }

    const removed = await removeTheme(id);
    if (!removed) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
    }
    await forgetExtensionInPolicy('theme', id);

    await auditLog('theme.delete', { id }, ip);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Theme delete error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
