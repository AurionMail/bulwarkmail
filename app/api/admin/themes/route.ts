import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth, getClientIP } from '@/lib/admin/session';
import { auditLog } from '@/lib/admin/audit';
import { logger } from '@/lib/logger';
import {
  getTheme,
  getThemeRegistry,
  saveTheme,
  deleteTheme as removeTheme,
  themeCSSResolver,
  type ServerTheme,
} from '@/lib/admin/plugin-registry';
import { forgetExtensionInPolicy } from '@/lib/admin/extension-cleanup';

import { readThemePackage } from '@/lib/extension-package';

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

    const read = await readThemePackage(await file.arrayBuffer(), {
      resolveExtends: await themeCSSResolver(),
    });
    if (!read.valid || !read.manifest) {
      return NextResponse.json({ error: read.errors.join('; ') }, { status: 400 });
    }
    const { manifest, css, skin, warnings } = read;

    const existing = await getTheme(manifest.id);
    const now = new Date().toISOString();
    const theme: ServerTheme = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description || '',
      variants: manifest.variants,
      enabled: existing?.enabled ?? true,
      ...(existing?.forceEnabled !== undefined ? { forceEnabled: existing.forceEnabled } : {}),
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };

    await saveTheme(theme, css, skin);
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
