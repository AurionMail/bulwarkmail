"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useUIStore } from "@/stores/ui-store";
import { usePaneSize } from "@/hooks/use-pane-size";

// Tailwind v4 breakpoints
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

const getMediaQueryServerSnapshot = () => false;

/**
 * SSR-safe media query hook. On SSR and the first hydration pass we report
 * `false`; on all subsequent client renders (including client-side navigation
 * remounts) we read `matchMedia` synchronously, so components don't flash
 * through a one-frame "mobile" layout on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getMediaQueryServerSnapshot);
}

/**
 * When the Pro shell renders a page inside a (possibly split) pane, that pane
 * publishes its measured width via `PaneSizeContext`. Inner pages should
 * branch their layout against the pane width - not the full viewport - so a
 * narrow pane gets the mobile/tablet layout instead of overflowing.
 *
 * Returns `null` when no pane size is published, signalling the caller to
 * fall back to `window.matchMedia`.
 */
function classifyPane(paneWidth: number | null) {
  if (paneWidth === null) return null;
  return {
    isMobile: paneWidth < BREAKPOINTS.md,
    isTablet: paneWidth >= BREAKPOINTS.md && paneWidth < BREAKPOINTS.lg,
    isDesktop: paneWidth >= BREAKPOINTS.lg,
  };
}

/**
 * Hook to detect device type and sync with UI store
 * Uses Tailwind breakpoints: mobile < 768px, tablet 768-1024px, desktop > 1024px
 *
 * When invoked inside a Pro pane, the returned values reflect the pane's
 * width instead of the window's. The global UI store is NOT updated in that
 * case - two split panes would otherwise fight to write conflicting values,
 * and the store is meant to mirror the actual viewport for callers that read
 * it directly (mobile navigation helpers etc.).
 */
export function useDeviceDetection() {
  const { setDeviceType, isMobile, isTablet, isDesktop } = useUIStore();
  const paneWidth = usePaneSize();
  const paneClassification = classifyPane(paneWidth);

  const isMobileQuery = useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
  const isTabletQuery = useMediaQuery(
    `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`
  );
  const isDesktopQuery = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);

  useEffect(() => {
    if (paneClassification) return;
    setDeviceType(isMobileQuery, isTabletQuery, isDesktopQuery);
  }, [isMobileQuery, isTabletQuery, isDesktopQuery, setDeviceType, paneClassification]);

  if (paneClassification) return paneClassification;
  return { isMobile, isTablet, isDesktop };
}

/**
 * Convenience hooks for specific breakpoints
 */
export function useIsMobile() {
  const paneWidth = usePaneSize();
  const viewport = useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
  return paneWidth !== null ? paneWidth < BREAKPOINTS.md : viewport;
}

export function useIsDesktop() {
  const paneWidth = usePaneSize();
  const viewport = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
  return paneWidth !== null ? paneWidth >= BREAKPOINTS.lg : viewport;
}
