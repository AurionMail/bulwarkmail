"use client";

import { useEffect } from "react";
import { IS_LITE } from "@/lib/lite";

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // sw.js enriches push notifications through /api/push/preview and serves
    // icons from /api/pwa-icon; neither exists in the static build. Push stays
    // off in Lite v1, so the worker is not registered at all.
    if (IS_LITE) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // In development, unregister any previously installed service worker
      // and clear its caches so hot reload always serves fresh assets.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }
      return;
    }

    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then((registration) => {
        console.log("Service Worker registered successfully:", registration);
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  }, []);

  return null;
}
