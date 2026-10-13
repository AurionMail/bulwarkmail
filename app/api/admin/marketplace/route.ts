import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth, getClientIP } from '@/lib/admin/session';
import { auditLog } from '@/lib/admin/audit';
import { logger } from '@/lib/logger';
import {
  savePlugin,
  saveTheme,
  getPlugin,
  getTheme,
  getPluginRegistry,
  getThemeRegistry,
  type ServerPlugin,
  type ServerTheme,
} from '@/lib/admin/plugin-registry';
import { invalidateFrameOriginsCache } from '@/lib/admin/csp-frame-origins';
import {
  EXTENSION_ID_RE,
  ExtensionPackageError,
  openPackage,
  readManifest,
  readPluginPackage,
  readText,
  suspiciousCode,
} from '@/lib/extension-package';
import { sanitizeThemeCSS } from '@/lib/theme-loader';
import { configManager } from '@/lib/admin/config-manager';

async function getDirectoryUrl(): Promise<string> {
  await configManager.ensureLoaded();
  return configManager.get<string>('extensionDirectoryUrl') || 'https://extensions.bulwarkmail.org';
}

/**
 * GET /api/admin/marketplace - Search/browse the extension directory
 * Proxies to the extension directory API
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const directoryUrl = await getDirectoryUrl();
    const { searchParams } = request.nextUrl;
    const url = new URL('/api/v1/extensions', directoryUrl);

    // Forward all search params
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch from extension directory' },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Enrich with install status
    const [pluginRegistry, themeRegistry] = await Promise.all([
      getPluginRegistry(),
      getThemeRegistry(),
    ]);

    const installedPluginVersions = new Map(
      pluginRegistry.plugins.map(p => [p.id, p.version] as const),
    );
    const installedThemeVersions = new Map(
      themeRegistry.themes.map(t => [t.id, t.version] as const),
    );

    const fileUrl = (path: unknown): string | null =>
      typeof path === 'string' && path
        ? new URL(`/api/v1/files/${path}`, directoryUrl).toString()
        : null;

    if (data.data) {
      data.data = data.data.map((ext: Record<string, unknown>) => {
        const slug = ext.slug as string;
        const installedVersion = ext.type === 'theme'
          ? installedThemeVersions.get(slug) ?? null
          : installedPluginVersions.get(slug) ?? null;
        return {
          ...ext,
          iconUrl: fileUrl(ext.iconPath),
          bannerUrl: fileUrl(ext.bannerPath),
          installed: installedVersion !== null,
          installedVersion,
        };
      });
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    logger.error('Marketplace search error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Failed to connect to extension directory' }, { status: 502 });
  }
}

/**
 * POST /api/admin/marketplace - Install an extension from the directory
 * Body: { slug: string, version: string, type: 'plugin' | 'theme' }
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const ip = getClientIP(request);
    const { slug, version, type } = await request.json();

    if (!slug || !version || !type) {
      return NextResponse.json({ error: 'Missing slug, version, or type' }, { status: 400 });
    }

    if (type !== 'plugin' && type !== 'theme') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // The slug becomes a file name and the registry key; it must be a plain id.
    if (typeof slug !== 'string' || !EXTENSION_ID_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Invalid id: must be lowercase alphanumeric with hyphens, min 2 chars' },
        { status: 400 },
      );
    }

    // Download the bundle from the directory
    const directoryUrl = await getDirectoryUrl();
    const bundleUrl = new URL(`/api/v1/bundle/${encodeURIComponent(slug)}/${encodeURIComponent(version)}`, directoryUrl);
    const bundleRes = await fetch(bundleUrl.toString(), {
      signal: AbortSignal.timeout(30000),
    });

    if (!bundleRes.ok) {
      return NextResponse.json(
        { error: `Failed to download bundle: ${bundleRes.status}` },
        { status: 502 }
      );
    }

    const buffer = await bundleRes.arrayBuffer();
    const now = new Date().toISOString();

    if (type === 'theme') {
      let pkg;
      let manifest: Record<string, unknown>;
      try {
        pkg = await openPackage(buffer, 'theme');
        manifest = await readManifest(pkg);
      } catch (err) {
        if (err instanceof ExtensionPackageError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
      }
      // The slug is what the admin picked and what install status is keyed
      // on. A bundle that names another id would install over whatever
      // already uses that id, keeping its enabled and force-enabled state.
      if (manifest.id !== undefined && manifest.id !== slug) {
        return NextResponse.json(
          { error: `Bundle id "${String(manifest.id)}" does not match the directory entry "${slug}"` },
          { status: 400 },
        );
      }
      const resolvedId = slug;

      let css: string | null;
      try {
        css = await readText(pkg, 'theme.css');
      } catch (err) {
        if (err instanceof ExtensionPackageError) return NextResponse.json({ error: err.message }, { status: 400 });
        throw err;
      }
      if (css === null) {
        return NextResponse.json({ error: 'Theme bundle missing theme.css' }, { status: 400 });
      }

      // Sanitize unconditionally: the safety check is advisory, and the
      // sanitizer is also what drops rules outside :root and .dark.
      const warnings: string[] = [];
      const sanitized = sanitizeThemeCSS(css);
      css = sanitized.css;
      warnings.push(...sanitized.warnings);

      const existingTheme = await getTheme(resolvedId);
      const isUpdate = existingTheme !== null;

      const theme: ServerTheme = {
        id: resolvedId,
        name: (manifest.name as string) || slug,
        // Prefer the directory-published version (what we requested) over
        // manifest.version. Publishers sometimes forget to bump the version
        // inside the bundle's manifest.json; trusting it would make the
        // update never appear to "stick" — the registry would keep showing
        // the older version even after a successful update.
        version: version || (manifest.version as string),
        author: (manifest.author as string) || 'Unknown',
        description: (manifest.description as string) || '',
        variants: (manifest.variants as string[]) || ['light', 'dark'],
        enabled: existingTheme?.enabled ?? true,
        ...(existingTheme?.forceEnabled !== undefined
          ? { forceEnabled: existingTheme.forceEnabled }
          : {}),
        installedAt: existingTheme?.installedAt ?? now,
        updatedAt: now,
      };

      await saveTheme(theme, css);
      await auditLog(
        isUpdate ? 'marketplace.update_theme' : 'marketplace.install_theme',
        {
          id: theme.id,
          name: theme.name,
          version: theme.version,
          slug,
          ...(isUpdate ? { previousVersion: existingTheme.version } : {}),
        },
        ip,
      );

      return NextResponse.json({ success: true, theme, warnings, updated: isUpdate });
    }

    // Plugin installation
    let pkg;
    try {
      pkg = await readPluginPackage(buffer, {
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        expectedId: slug,
      });
    } catch (err) {
      if (err instanceof ExtensionPackageError) {
        // Same wording the admin UI already shows for an id mismatch.
        const message = err.message.replace(/Package id "([^"]*)" does not match "([^"]*)"/, 'Bundle id "$1" does not match the directory entry "$2"');
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw err;
    }
    const { manifest, code } = pkg;

    // Block plugins with dangerous JS patterns
    const suspicious = suspiciousCode(code);
    if (suspicious.length > 0) {
      return NextResponse.json(
        { error: `Plugin rejected: contains ${suspicious.join(', ')}. These patterns are not allowed for security reasons.` },
        { status: 400 },
      );
    }

    const existingPlugin = await getPlugin(slug);
    const isUpdate = existingPlugin !== null;

    const plugin: ServerPlugin = {
      id: slug,
      name: manifest.name,
      // See theme branch: trust the directory-published version, not
      // manifest.version, so updates actually stick in the registry.
      version: version || manifest.version,
      author: manifest.author,
      description: manifest.description,
      type: manifest.type,
      ...(manifest.tier === 'privileged' ? { tier: 'privileged' } : {}),
      permissions: manifest.permissions,
      entrypoint: manifest.entrypoint,
      enabled: existingPlugin?.enabled ?? true,
      ...(existingPlugin?.forceEnabled !== undefined
        ? { forceEnabled: existingPlugin.forceEnabled }
        : {}),
      installedAt: existingPlugin?.installedAt ?? now,
      updatedAt: now,
      ...(manifest.configSchema ? { configSchema: manifest.configSchema } : {}),
      ...(manifest.settingsSchema ? { settingsSchema: manifest.settingsSchema } : {}),
      ...(manifest.frameOrigins ? { frameOrigins: manifest.frameOrigins } : {}),
      ...(manifest.httpOrigins ? { httpOrigins: manifest.httpOrigins } : {}),
      ...(manifest.apiPostPaths ? { apiPostPaths: manifest.apiPostPaths } : {}),
      ...(manifest.locales ? { locales: manifest.locales } : {}),
    };

    await savePlugin(plugin, code);
    invalidateFrameOriginsCache();
    await auditLog(
      isUpdate ? 'marketplace.update_plugin' : 'marketplace.install_plugin',
      {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        slug,
        frameOrigins: plugin.frameOrigins ?? [],
        httpOrigins: plugin.httpOrigins ?? [],
        apiPostPaths: plugin.apiPostPaths ?? [],
        ...(isUpdate ? { previousVersion: existingPlugin.version } : {}),
      },
      ip,
    );

    return NextResponse.json({ success: true, plugin, warnings: pkg.warnings, updated: isUpdate });
  } catch (error) {
    logger.error('Marketplace install error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Installation failed' }, { status: 500 });
  }
}
