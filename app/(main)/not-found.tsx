"use client";

import { useEffect } from "react";
import { getPathPrefix } from "@/lib/browser-navigation";
import { NotFoundView } from "@/components/error/not-found-view";
import { IS_LITE } from "@/lib/lite";
import { liteSurfaceRootFor, stashPendingLitePath } from "@/lib/lite-link-segments";

// Outside the locale tree there are no translations: paths below a locale
// get the translated page in [locale]/not-found.tsx.
export default function NotFound() {
  useEffect(() => {
    // Static Lite build on a host without rewrite rules (GitHub Pages): a deep
    // link such as /en/mail/thread/abc lands here as 404.html. Park the link
    // and load the owning surface, which replays it (hooks/use-lite-link-segments.ts).
    if (IS_LITE) {
      const target = liteSurfaceRootFor(window.location.pathname, getPathPrefix());
      if (target) {
        stashPendingLitePath(`${window.location.pathname}${window.location.search}`);
        window.location.replace(target);
        return;
      }
    }
  }, []);

  return (
    <NotFoundView
      title="Page not found"
      description="This page doesn't exist or has moved. Check the address, or go back to your inbox."
      homeLabel="Go to inbox"
    />
  );
}
