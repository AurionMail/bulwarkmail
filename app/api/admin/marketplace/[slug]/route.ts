import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/session';
import { logger } from '@/lib/logger';
import {
  getPluginRegistry,
  getThemeRegistry,
} from '@/lib/admin/plugin-registry';
import { openPackage, readManifest, readText } from '@/lib/extension-package';
import { configManager } from '@/lib/admin/config-manager';
import { checkBundleSignature, type SignatureCheck } from '@/lib/admin/directory-keys';

async function getDirectoryUrl(): Promise<string> {
  await configManager.ensureLoaded();
  return configManager.get<string>('extensionDirectoryUrl') || 'https://extensions.bulwarkmail.org';
}

const MAX_PREVIEW_SOURCE_LEN = 100_000;

/**
 * GET /api/admin/marketplace/[slug]
 * Returns full preview info for an extension: directory metadata,
 * the bundle's manifest, a (truncated) source preview, and install status.
 * Lets admins audit what they're about to install before pressing the button.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const { slug } = await params;
    const directoryUrl = await getDirectoryUrl();

    // 1. Extension metadata + screenshots + theme previews from the directory
    const detailUrl = new URL(`/api/v1/extension/${encodeURIComponent(slug)}`, directoryUrl);
    if (process.env.NEXT_PUBLIC_APP_VERSION) detailUrl.searchParams.set('appVersion', process.env.NEXT_PUBLIC_APP_VERSION);
    const detailRes = await fetch(detailUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!detailRes.ok) {
      const status = detailRes.status === 404 ? 404 : 502;
      return NextResponse.json(
        { error: status === 404 ? 'Extension not found' : 'Directory request failed' },
        { status },
      );
    }

    const detailJson = await detailRes.json();
    const extension = detailJson.data as Record<string, unknown> | undefined;
    if (!extension) {
      return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
    }

    const type = extension.type as 'plugin' | 'theme';
    const latestVersion = (extension.latestVersion as { version?: string } | null)?.version
      ?? null;

    // 2. Pull the bundle so we can show what's actually inside.
    let manifest: Record<string, unknown> | null = null;
    let sourcePreview: { name: string; content: string; truncated: boolean } | null = null;
    let bundleError: string | null = null;
    let bundleSize = 0;
    let signature: SignatureCheck | null = null;

    if (latestVersion) {
      try {
        const bundleUrl = new URL(
          `/api/v1/bundle/${encodeURIComponent(slug)}/${encodeURIComponent(latestVersion)}`,
          directoryUrl,
        );
        const bundleRes = await fetch(bundleUrl.toString(), {
          signal: AbortSignal.timeout(30000),
        });

        if (!bundleRes.ok) {
          bundleError = `Bundle download failed (${bundleRes.status})`;
        } else {
          const buffer = await bundleRes.arrayBuffer();
          bundleSize = buffer.byteLength;
          signature = await checkBundleSignature({
            directoryUrl,
            configuredRootKeys: configManager.get<string>('extensionDirectoryRootKeys'),
            slug,
            version: latestVersion,
            kind: type === 'theme' ? 'theme' : 'plugin',
            bytes: buffer,
            headers: bundleRes.headers,
          });
          // Opening the preview must not inflate an arbitrary bundle in
          // full: every read goes through the capped package reader.
          const pkg = await openPackage(buffer, type === 'theme' ? 'theme' : 'plugin');
          try {
            manifest = await readManifest(pkg);
          } catch (err) {
            bundleError = err instanceof Error ? err.message : 'Invalid manifest.json in bundle';
          }

          if (manifest) {
            const name = type === 'theme'
              ? 'theme.css'
              : (typeof manifest.entrypoint === 'string' && manifest.entrypoint) || 'index.js';
            const content = await readText(pkg, name);
            if (content !== null) {
              sourcePreview = {
                name,
                content: content.length > MAX_PREVIEW_SOURCE_LEN
                  ? content.slice(0, MAX_PREVIEW_SOURCE_LEN)
                  : content,
                truncated: content.length > MAX_PREVIEW_SOURCE_LEN,
              };
            }
          }
        }
      } catch (err) {
        bundleError = err instanceof Error ? err.message : 'Failed to read bundle';
      }
    } else {
      bundleError = 'Extension has no published version';
    }

    // 3. Install status (slug is used as the registry id at install time)
    const [pluginRegistry, themeRegistry] = await Promise.all([
      getPluginRegistry(),
      getThemeRegistry(),
    ]);
    const installedEntry = type === 'theme'
      ? themeRegistry.themes.find((t) => t.id === slug)
      : pluginRegistry.plugins.find((p) => p.id === slug);
    const installed = installedEntry !== undefined;
    const installedVersion = installedEntry?.version ?? null;

    // 4. Build screenshot URLs (proxy through the directory's public files endpoint).
    const screenshots = Array.isArray(extension.screenshots)
      ? (extension.screenshots as Array<{ path: string; altText?: string | null }>).map((s) => ({
          url: new URL(`/api/v1/files/${s.path}`, directoryUrl).toString(),
          altText: s.altText ?? null,
        }))
      : [];

    // Strip the heavy `manifest` blob from versions when echoing the directory data.
    const versions = Array.isArray(extension.versions)
      ? (extension.versions as Array<Record<string, unknown>>).map((v) => ({
          version: v.version,
          changelog: v.changelog,
          bundleSize: v.bundleSize,
          minAppVersion: v.minAppVersion,
          publishedAt: v.publishedAt,
          permissions: v.permissions,
        }))
      : [];

    const fileUrl = (path: unknown): string | null =>
      typeof path === 'string' && path
        ? new URL(`/api/v1/files/${path}`, directoryUrl).toString()
        : null;

    return NextResponse.json(
      {
        extension: {
          slug: extension.slug,
          name: extension.name,
          type: extension.type,
          pluginType: extension.pluginType ?? null,
          description: extension.description,
          longDescription: extension.longDescription ?? null,
          tags: extension.tags ?? [],
          permissions: extension.permissions ?? [],
          totalDownloads: extension.totalDownloads ?? 0,
          featured: extension.featured ?? false,
          githubRepo: extension.githubRepo ?? null,
          license: extension.license ?? null,
          minAppVersion: extension.minAppVersion ?? null,
          iconUrl: fileUrl(extension.iconPath),
          bannerUrl: fileUrl(extension.bannerPath),
          author: extension.author ?? null,
          latestVersion,
          versions,
          screenshots,
          themePreviews: extension.themePreviews ?? [],
          createdAt: extension.createdAt ?? null,
          updatedAt: extension.updatedAt ?? null,
        },
        bundle: {
          manifest,
          source: sourcePreview,
          size: bundleSize,
          error: bundleError,
          signature,
        },
        installed,
        installedVersion,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error('Marketplace preview error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to load preview' },
      { status: 502 },
    );
  }
}
