import type { AppSurface } from '@/lib/deep-links';

/**
 * Handoff for a deep link that has to survive a route change (#733).
 *
 * The Pro shell owns a single route (`/pro`) and renders each surface inside a
 * tab, so a permalink like `/mail/message/<id>` can't reach the surface as a
 * route param: ProInterfaceRedirect intercepts it and replaces the URL. It
 * parks the segments here, opens the right tab, and the surface picks them up
 * on mount - exactly like `protocol-handlers/session` does for `mailto:`.
 *
 * Some links carry a query-string half too (`?account=` for calendar events,
 * `?preview=` for files). Under `/pro` the address bar has no search string
 * left by the time the surface parses the link, so it travels with the parked
 * entry instead of being read back from `window.location`.
 *
 * Surfaces in the Pro shell stay mounted for the whole session, so a link that
 * arrives *while the shell is already running* (an in-app link to
 * `/settings/folders`, a `mailto:`-style handoff, ...) would be parked and
 * never seen - the mount-time consume has long since run. For that case a
 * mounted surface subscribes here: when a listener exists, `setPendingDeepLink`
 * delivers the segments to it directly instead of parking them.
 *
 * Module state, deliberately: it must not survive a reload (the URL is gone by
 * then, so re-applying it would reopen something the user already closed).
 */
export interface PendingDeepLink {
  segments: string[];
  /** Query-string half of the link (leading `?` included), when it has one. */
  search?: string;
}

const pending = new Map<AppSurface, PendingDeepLink>();

type PendingDeepLinkListener = (segments: string[], search?: string) => void;

const listeners = new Map<AppSurface, Set<PendingDeepLinkListener>>();

export function setPendingDeepLink(surface: AppSurface, segments: string[], search?: string): void {
  const live = listeners.get(surface);
  if (live && live.size > 0) {
    // A mounted surface is listening - deliver instead of parking, so links
    // arriving while the Pro shell is already running still land.
    // No trailing undefined: listeners predating the search half see the
    // exact call shape they always did.
    for (const listener of [...live]) {
      if (search === undefined) listener(segments);
      else listener(segments, search);
    }
    return;
  }
  pending.set(surface, { segments, search });
}

/**
 * Hands a link to a surface that is mounted and listening, and says whether
 * one was. Unlike setPendingDeepLink it never parks the link: without a
 * listener the caller navigates instead, and the surface reads the link from
 * the route when it mounts.
 */
export function deliverDeepLink(surface: AppSurface, segments: string[], search?: string): boolean {
  const live = listeners.get(surface);
  if (!live || live.size === 0) return false;
  setPendingDeepLink(surface, segments, search);
  return true;
}

/** Returns the parked link once, then forgets it. */
export function consumePendingDeepLinkEntry(surface: AppSurface): PendingDeepLink | null {
  const entry = pending.get(surface);
  if (!entry) return null;
  pending.delete(surface);
  return entry;
}

/** Segments-only variant for surfaces whose links never carry a search string. */
export function consumePendingDeepLink(surface: AppSurface): string[] | null {
  return consumePendingDeepLinkEntry(surface)?.segments ?? null;
}

/**
 * Live delivery for an already-mounted surface (the Pro shell keeps surfaces
 * mounted for the whole session). Returns the unsubscribe function. While the
 * Pro interface is on, only the embedded (Pro) instance of a surface should
 * subscribe - during a cold-load redirect the standard instance briefly
 * renders too and must not steal the link parked for the Pro instance that
 * mounts right after.
 */
export function subscribePendingDeepLink(
  surface: AppSurface,
  listener: PendingDeepLinkListener,
): () => void {
  let set = listeners.get(surface);
  if (!set) {
    set = new Set();
    listeners.set(surface, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function clearPendingDeepLinks(): void {
  pending.clear();
}
