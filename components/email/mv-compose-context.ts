"use client";

import { createContext, useContext } from "react";

export type MvComposeWindowState = "normal" | "minimized" | "maximized";

/**
 * Set by Mountain View's compose window around the composer inside it, so the
 * composer can draw the window's title bar (title, minimise, full screen,
 * close) and its Gmail-style bottom bar itself. Outside that window it is
 * null and the composer keeps its own chrome.
 */
export interface MvComposeWindowControls {
  state: MvComposeWindowState;
  setState: (state: MvComposeWindowState) => void;
}

export const MvComposeWindowContext = createContext<MvComposeWindowControls | null>(null);

export function useMvComposeWindow(): MvComposeWindowControls | null {
  return useContext(MvComposeWindowContext);
}
