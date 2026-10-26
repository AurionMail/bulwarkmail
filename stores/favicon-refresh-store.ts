import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Domains whose favicon failed to load in this tab. Avatars skip them so a
// missing icon isn't requested again on every render.
export const failedFaviconDomains = new Set<string>();

interface FaviconRefreshState {
  /** When the user last asked for fresh sender icons (ms), 0 if never. */
  refreshedAt: number;
  refresh: () => void;
}

// Sender favicons are cached for two weeks by the browser and by the
// /api/favicon proxy. Refreshing stamps a new time that avatars append to the
// favicon URL (so the browser and any proxy in between miss their cache) and
// that the route compares against its own cache entry (issue #960).
export const useFaviconRefreshStore = create<FaviconRefreshState>()(
  persist(
    (set) => ({
      refreshedAt: 0,
      refresh: () => {
        failedFaviconDomains.clear();
        set({ refreshedAt: Date.now() });
      },
    }),
    { name: 'favicon-refresh', partialize: (s) => ({ refreshedAt: s.refreshedAt }) },
  ),
);
