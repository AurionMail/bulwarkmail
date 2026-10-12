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
  /**
   * `window` is the docked compose window; `inline` is a reply written in
   * place under the conversation, which can be popped out into a window.
   */
  variant: "window" | "inline";
  state: MvComposeWindowState;
  setState: (state: MvComposeWindowState) => void;
  /** Inline only: move the reply into a docked window. */
  popOut?: () => void;
}

export const MvComposeWindowContext = createContext<MvComposeWindowControls | null>(null);

export function useMvComposeWindow(): MvComposeWindowControls | null {
  return useContext(MvComposeWindowContext);
}
