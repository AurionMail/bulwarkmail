"use client";

import { useEffect } from "react";
import { startIosViewportHeal } from "@/lib/ios-viewport-heal";

/** Restores the full viewport height in iOS home-screen apps (#1226). */
export function IosViewportHeal() {
  useEffect(() => startIosViewportHeal(), []);
  return null;
}
