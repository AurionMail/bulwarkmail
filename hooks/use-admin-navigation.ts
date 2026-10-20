'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { withBasePath } from '@/lib/browser-navigation';
import { parseAdminPath, type AdminLocation } from '@/lib/admin/admin-nav';

/**
 * Moves the admin panel to another of its pages without a route transition.
 *
 * The admin tree is one Next route, so a page switch is a history entry and
 * nothing else: Next patches `history.pushState`, copies its own bookkeeping
 * into the entry when the state passed is null, and updates `usePathname()`.
 * Passing the current `history.state` instead would skip that sync, so the
 * state here is always null. The back button lands on the previous entry
 * the same way (Next's popstate handler restores the URL from the entry).
 */
export function navigateAdmin(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const url = withBasePath(path);
  if (`${window.location.pathname}${window.location.search}` === url && !options.replace) return;
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

const INDEX: AdminLocation = { page: null, detail: null };

/** The page (and detail) the address bar names right now. */
export function useAdminLocation(): AdminLocation {
  const pathname = usePathname();
  return useMemo(() => parseAdminPath(pathname ?? '') ?? INDEX, [pathname]);
}
