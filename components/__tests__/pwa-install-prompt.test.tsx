import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
  PWAInstallPrompt,
} from "../pwa-install-prompt";
import { useComposingSurface } from "@/hooks/use-composing-surface";
import { useUIStore } from "@/stores/ui-store";

vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({
    appName: "Bulwark",
    faviconUrl: "",
    appLogoLightUrl: "",
    appLogoDarkUrl: "",
  }),
}));

function installPromptEvent(): Event {
  const event = new Event("beforeinstallprompt");
  Object.assign(event, {
    prompt: vi.fn(),
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  return event;
}

function Composer() {
  useComposingSurface();
  return null;
}

describe("PWAInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ composingCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes after the browser install prompt is dismissed", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });

    render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(event));
    expect(screen.getByText("title")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("install"));
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });

  it("announces that it is hidden after Not now", () => {
    const visibility: boolean[] = [];
    const listener = (event: Event) => {
      visibility.push(
        (event as CustomEvent<{ visible?: boolean }>).detail?.visible === true,
      );
    };
    window.addEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);

    try {
      const event = new Event("beforeinstallprompt");
      Object.assign(event, {
        prompt: vi.fn(),
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });

      render(<PWAInstallPrompt />);
      act(() => window.dispatchEvent(event));
      fireEvent.click(screen.getByText("not_now"));

      expect(visibility).toContain(true);
      expect(visibility.at(-1)).toBe(false);
    } finally {
      window.removeEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);
    }
  });

  it("remembers Not now for a week, after a reload too", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(installPromptEvent()));
    fireEvent.click(screen.getByText("not_now"));
    first.unmount();

    // The next page load, or the next account, gets a fresh event.
    const second = render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(installPromptEvent()));
    expect(screen.queryByText("title")).not.toBeInTheDocument();
    second.unmount();

    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(installPromptEvent()));
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("still shows when localStorage is unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      render(<PWAInstallPrompt />);
      act(() => window.dispatchEvent(installPromptEvent()));
      expect(screen.getByText("title")).toBeInTheDocument();
      fireEvent.click(screen.getByText("not_now"));
      expect(screen.queryByText("title")).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("stays off the screen while a composer is open", () => {
    const visibility: boolean[] = [];
    const listener = (event: Event) => {
      visibility.push(
        (event as CustomEvent<{ visible?: boolean }>).detail?.visible === true,
      );
    };
    window.addEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);

    try {
      const { rerender } = render(<PWAInstallPrompt />);
      act(() => window.dispatchEvent(installPromptEvent()));
      expect(screen.getByText("title")).toBeInTheDocument();

      rerender(<><PWAInstallPrompt /><Composer /></>);
      expect(screen.queryByText("title")).not.toBeInTheDocument();
      // Still pending, so the push prompt doesn't move into its place.
      expect(visibility.at(-1)).toBe(true);

      rerender(<PWAInstallPrompt />);
      expect(screen.getByText("title")).toBeInTheDocument();
    } finally {
      window.removeEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);
    }
  });
});
