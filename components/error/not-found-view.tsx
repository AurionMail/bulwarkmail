"use client";

import { useEffect, useState } from "react";
import { SearchX } from "@/components/icons";
import { useAuthStore } from "@/stores/auth-store";
import { getPathPrefix } from "@/lib/browser-navigation";

/** Whether the current URL is an admin page, which has its own sign-in. */
function isAdminPath(): boolean {
  if (typeof window === "undefined") return false;
  const adminBase = `${getPathPrefix()}/admin`;
  const path = window.location.pathname;
  return path === adminBase || path.startsWith(`${adminBase}/`);
}

/**
 * Who is looking at a missing page: "checking" until the stored session has
 * been restored, then signed in or not. Deciding before that sent a signed-in
 * user with a mistyped URL to the login page.
 */
export function useNotFoundAuth(): "checking" | "signed-in" | "signed-out" {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [checked, setChecked] = useState(() => useAuthStore.getState().isAuthenticated);

  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated) {
      setChecked(true);
      return;
    }
    let cancelled = false;
    void useAuthStore.getState().checkAuth().finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!checked || isAuthenticated || isAdminPath()) return;
    window.location.href = `${getPathPrefix()}/login`;
  }, [checked, isAuthenticated]);

  if (isAuthenticated) return "signed-in";
  return checked ? "signed-out" : "checking";
}

export interface NotFoundViewProps {
  title: string;
  description: string;
  homeLabel: string;
}

/** The 404 page: what happened and the way back. Signed out, it shows only on admin paths. */
export function NotFoundView({ title, description, homeLabel }: NotFoundViewProps) {
  const auth = useNotFoundAuth();
  if (auth !== "signed-in" && !isAdminPath()) return null;

  const prefix = typeof window !== "undefined" ? getPathPrefix() : "";
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <SearchX className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground mb-6">{description}</p>
        <a
          href={`${prefix}/`}
          className="inline-flex items-center justify-center h-9 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {homeLabel}
        </a>
      </div>
    </div>
  );
}
