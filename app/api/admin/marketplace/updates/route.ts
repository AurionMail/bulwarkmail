import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/session';
import { logger } from '@/lib/logger';
import {
  APP_VERSION,
  DirectoryError,
  askDirectoryAbout,
  directoryJson,
  getDirectoryChannel,
  getDirectoryUrl,
  installedExtensions,
  v2Url,
  type DirectoryAdvisory,
  type DirectoryVersion,
} from '@/lib/admin/marketplace-directory';

export interface UpdatesAnswer {
  updates: Array<DirectoryVersion & { slug: string; currentVersion: string; changelog: string | null }>;
  yanked: Array<{ slug: string; version: string; reason: string | null; at: string }>;
  deprecated: Array<{ slug: string; message: string | null; replacement: string | null }>;
  suspended: string[];
  advisories: DirectoryAdvisory[];
  unknown: string[];
}

const EMPTY: UpdatesAnswer = { updates: [], yanked: [], deprecated: [], suspended: [], advisories: [], unknown: [] };

/**
 * GET /api/admin/marketplace/updates
 *
 * Asks the directory about every installed extension that came from it (or
 * predates the record of where it came from): newer versions this Bulwark
 * can run, versions the publisher withdrew, deprecations, suspensions and
 * security advisories. Also lists what is installed, so the marketplace can
 * show the "Installed" view from one request.
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const installed = await installedExtensions();
    const list = [...installed].map(([id, e]) => ({ id, ...e }));
    const ask = list.filter((e) => askDirectoryAbout(e.source)).map((e) => ({ slug: e.id, version: e.version }));

    const directoryUrl = await getDirectoryUrl();
    const channel = getDirectoryChannel();
    let answer: UpdatesAnswer = EMPTY;
    let error: string | null = null;
    if (ask.length > 0) {
      try {
        const res = await directoryJson<{ data: UpdatesAnswer }>(v2Url(directoryUrl, '/updates'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appVersion: APP_VERSION || undefined, channel, installed: ask }),
        });
        answer = { ...EMPTY, ...res.data };
      } catch (err) {
        // The installed list is still useful without the directory; say what
        // went wrong instead of failing the whole view.
        error = err instanceof DirectoryError ? err.message : 'Could not reach the extension directory';
        logger.warn('Marketplace updates check failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json(
      { installed: list, ...answer, directoryUrl, channel, appVersion: APP_VERSION || null, error },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error('Marketplace updates error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Failed to check for updates' }, { status: 500 });
  }
}
