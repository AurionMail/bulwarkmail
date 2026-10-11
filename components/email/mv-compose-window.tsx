"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MvComposeWindowContext, type MvComposeWindowState } from "@/components/email/mv-compose-context";

/**
 * Mountain View's compose window: a panel docked at the bottom-right corner
 * over the mail list, which can be folded down to its title bar or opened up
 * to a large centred dialog. The composer inside stays mounted throughout, so
 * folding it keeps the draft exactly as it was. The composer draws the title
 * bar and its buttons itself, from MvComposeWindowContext.
 */
export function MvComposeWindow({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MvComposeWindowState>("normal");
  const minimized = state === "minimized";
  const maximized = state === "maximized";
  const controls = useMemo(() => ({ state, setState }), [state]);

  return (
    <MvComposeWindowContext.Provider value={controls}>
      {maximized && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          aria-hidden
          onClick={() => setState("normal")}
        />
      )}
      <div
        data-mv-compose-window=""
        data-state={state}
        className={cn(
          "fixed z-40 flex flex-col overflow-hidden bg-background shadow-[0_8px_10px_1px_rgb(0_0_0/0.14),0_3px_14px_2px_rgb(0_0_0/0.12),0_5px_5px_-3px_rgb(0_0_0/0.2)]",
          maximized
            ? "inset-x-[8vw] inset-y-[6vh] rounded-lg"
            : "bottom-0 end-4 w-[min(560px,calc(100vw-2rem))] rounded-t-lg",
          minimized && "h-10 w-[min(280px,calc(100vw-2rem))]",
          state === "normal" && "h-[min(600px,calc(100dvh-5rem))]",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </MvComposeWindowContext.Provider>
  );
}
