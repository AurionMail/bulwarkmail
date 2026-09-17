"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { getPathPrefix } from "@/lib/browser-navigation";
import { IS_LITE } from "@/lib/lite";
import { liteSurfaceRootFor, stashPendingLitePath } from "@/lib/lite-link-segments";

export default function NotFound() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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
    if (!isAuthenticated) {
      const prefix = getPathPrefix();
      // Don't redirect admin routes to the webmail login page. Admin paths
      // are mounted relative to the deployment prefix, so account for it.
      const adminBase = `${prefix}/admin`;
      const isAdminRoute = window.location.pathname === adminBase || window.location.pathname.startsWith(`${adminBase}/`);
      if (!isAdminRoute) {
        window.location.href = `${prefix}/login`;
      }
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    let isAdmin = false;
    if (typeof window !== 'undefined') {
      const prefix = getPathPrefix();
      const adminBase = `${prefix}/admin`;
      isAdmin = window.location.pathname === adminBase || window.location.pathname.startsWith(`${adminBase}/`);
    }
    if (!isAdmin) return null;
  }

  const prefix = typeof window !== 'undefined' ? getPathPrefix() : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>
        <p className="text-muted-foreground mb-6">This page could not be found.</p>
        <a
          href={`${prefix}/`}
          className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
