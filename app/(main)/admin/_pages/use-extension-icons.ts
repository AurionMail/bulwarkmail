'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/browser-navigation';
import type { MarketplaceListing } from '@/lib/admin/marketplace-directory';
import type { ExtensionEntry } from './extension-detail';

/**
 * Brand icons for installed plugins and themes. An installed bundle carries
 * no image (the manifest's `icon` is marketplace media the directory
 * serves), so the icons come from the directory's listing, matched by slug.
 * Fetched once per session; an unreachable directory just means the
 * generic icons stay.
 */
let cache: Map<string, string> | null = null;
let pending: Promise<Map<string, string>> | null = null;

async function loadIcons(): Promise<Map<string, string>> {
  const icons = new Map<string, string>();
  for (let page = 1; page <= 5; page++) {
    const res = await apiFetch(`/api/admin/marketplace?page=${page}&perPage=100`);
    if (!res.ok) break;
    const data = await res.json() as { data?: MarketplaceListing[]; meta?: { total?: number; perPage?: number } };
    for (const ext of data.data ?? []) {
      if (ext.iconUrl) icons.set(ext.slug, ext.iconUrl);
    }
    const seen = page * (data.meta?.perPage ?? 100);
    if (!data.data?.length || seen >= (data.meta?.total ?? 0)) break;
  }
  return icons;
}

export function useExtensionIcons(): (entry: Pick<ExtensionEntry, 'id' | 'source'>) => string | null {
  const [icons, setIcons] = useState<Map<string, string> | null>(cache);
  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    pending ??= loadIcons().then((map) => { cache = map; return map; }).catch(() => new Map<string, string>());
    pending.then((map) => { if (!cancelled) setIcons(map); });
    return () => { cancelled = true; };
  }, []);
  return (entry) => {
    if (!icons) return null;
    const slug = entry.source?.kind === 'marketplace' ? entry.source.slug : entry.id;
    return icons.get(slug) ?? null;
  };
}

/** Test hook: forget what was fetched. */
export function resetExtensionIconCache(): void {
  cache = null;
  pending = null;
}
