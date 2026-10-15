"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Starts loading the mail view's code while the login form is on screen.
 * Signing in pushes to it, and without this its scripts were only requested
 * once the sign-in had finished, adding their download to every login.
 */
export function usePrefetchMailView(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    router.prefetch("/");
  }, [enabled, router]);
}
