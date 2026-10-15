import { authHooks } from "@/lib/plugin-hooks";
import {
    PLUGIN_OAUTH_EVENT,
    PLUGIN_OAUTH_STORAGE_KEY,
    createOAuthState,
} from "@/lib/plugin-oauth";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginOAuthCallbackListener } from "../providers/plugin-oauth-callback-listener";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
const mockUsePathname = vi.mocked(usePathname);

function emitStorageEvent(newValue: string | null) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: PLUGIN_OAUTH_STORAGE_KEY,
        newValue,
      }),
    );
  });
}

let STATE = "";

describe("PluginOAuthCallbackListener", () => {
  let handler: (payload: unknown) => Promise<void>;
  let disposable: { dispose: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePathname.mockReturnValue("/en/mail");
    handler = vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined);
    disposable = authHooks.onOAuthCallback.register("test-plugin", handler);
    STATE = createOAuthState("test-plugin");
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("delivers a success payload via the storage event", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: STATE, receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", state: STATE }),
    );
    // Best-effort cleanup after delivery
    expect(localStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBeNull();
    unmount();
  });

  it("delivers an error payload (denial) with state", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { state: STATE, error: "access_denied", receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ state: STATE, error: "access_denied" }),
    );
    unmount();
  });

  it("does nothing on the callback route", () => {
    mockUsePathname.mockReturnValue("/en/plugins/oauth/callback");
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: STATE, receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    // No cleanup either - the payload stays parked for the other tab
    expect(localStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBe(payload ? JSON.stringify(payload) : null);
    unmount();
  });

  it("ignores malformed payloads", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);

    emitStorageEvent("not json");
    emitStorageEvent(JSON.stringify({ foo: "bar" }));
    emitStorageEvent(JSON.stringify({ code: 123, state: STATE }));
    emitStorageEvent(null);

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores payloads without state", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);

    // A payload with no state at all cannot be matched to any pending flow,
    // so the listener drops it rather than broadcasting an unmatchable event.
    emitStorageEvent(JSON.stringify({ code: "abc", receivedAt: 1 }));
    emitStorageEvent(JSON.stringify({ error: "server_error", receivedAt: 1 }));

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("deduplicates identical payloads within the window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { unmount } = render(<PluginOAuthCallbackListener />);
      const payload = { code: "abc", state: STATE, receivedAt: 1 };
      localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

      emitStorageEvent(JSON.stringify(payload));
      emitStorageEvent(JSON.stringify(payload));

      expect(handler).toHaveBeenCalledOnce();

      // A state is used once: replaying it later delivers nothing either.
      vi.setSystemTime(61_000);
      emitStorageEvent(JSON.stringify(payload));
      expect(handler).toHaveBeenCalledOnce();

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers same-tab custom events", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: STATE, receivedAt: 1 };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", state: STATE }),
    );
    unmount();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    unmount();

    const payload = { code: "abc", state: STATE, receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));
    emitStorageEvent(JSON.stringify(payload));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers the code only to the plugin that started the flow", () => {
    // Every plugin with http:fetch used to receive every code.
    const other = vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const otherDisposable = authHooks.onOAuthCallback.register("other-plugin", other);
    const { unmount } = render(<PluginOAuthCallbackListener />);

    emitStorageEvent(JSON.stringify({ code: "abc", state: STATE, receivedAt: 1 }));

    expect(handler).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    otherDisposable.dispose();
    unmount();
  });

  it("drops a callback whose state no plugin created", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = render(<PluginOAuthCallbackListener />);

    emitStorageEvent(JSON.stringify({ code: "abc", state: "made-up", receivedAt: 1 }));

    expect(handler).not.toHaveBeenCalled();
    warn.mockRestore();
    unmount();
  });
});
