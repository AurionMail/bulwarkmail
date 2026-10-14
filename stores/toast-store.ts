import { create } from "zustand";
import { Toast, ToastAction } from "@/components/ui/toast";
import { generateUUID } from "@/lib/utils";
import { toastHooks } from "@/lib/plugin-hooks";
import { recordNotification } from "@/stores/notification-center-store";

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  /** Change a shown toast in place, e.g. to move a progress toast along. */
  updateToast: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    // FTM fix (2026-08-22): crypto.randomUUID() only exists in SECURE contexts
    // (https/localhost). On a plain-http LAN origin it is undefined, so EVERY
    // toast crashed -- and took the caller's post-success path down with it
    // (calendar save: the success toast threw before the dialog-close ran).
    const id = generateUUID();
    const newToast: Toast = {
      ...toast,
      id,
      duration: toast.duration ?? 5000,
    };

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));
    void toastHooks.onToastShow.emit({
      id, type: toast.type, title: toast.title, message: toast.message ?? "",
    });
    // Errors and warnings stay in the bell's list after the toast is gone.
    if (toast.type === "error" || toast.type === "warning") {
      recordNotification({ level: toast.type, title: toast.title, body: toast.message ?? "" });
    }
    return id;
  },

  updateToast: (id, patch) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  removeToast: (id) => {
    if (!get().toasts.some((t) => t.id === id)) return;
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
    void toastHooks.onToastDismiss.emit({ id });
  },

  clearToasts: () => {
    set({ toasts: [] });
  },
}));

interface ToastOptions {
  message?: string;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  tertiaryAction?: ToastAction;
  duration?: number;
  pauseOnHover?: boolean;
}

function showToast(type: Toast["type"], title: string, options?: string | ToastOptions, defaultDuration?: number): void {
  const opts = typeof options === "string" ? { message: options } : options;
  useToastStore.getState().addToast({
    type,
    title,
    message: opts?.message,
    action: opts?.action,
    secondaryAction: opts?.secondaryAction,
    tertiaryAction: opts?.tertiaryAction,
    duration: opts?.duration ?? defaultDuration,
    pauseOnHover: opts?.pauseOnHover,
  });
}

interface ProgressToastOptions {
  message?: string;
  /** 0..1, or null while unknown. */
  progress: number | null;
  action?: ToastAction;
}

export const toast = {
  /**
   * A toast for work in progress. It stays until updated or dismissed; move
   * it along with `toast.update(id, { progress, message })`.
   */
  progress: (title: string, options: ProgressToastOptions): string =>
    useToastStore.getState().addToast({ type: "info", title, duration: 0, ...options }),
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => useToastStore.getState().updateToast(id, patch),
  dismiss: (id: string) => useToastStore.getState().removeToast(id),
  success: (title: string, options?: string | ToastOptions) => showToast("success", title, options),
  error: (title: string, options?: string | ToastOptions) => showToast("error", title, options, 10000),
  info: (title: string, options?: string | ToastOptions) => showToast("info", title, options),
  warning: (title: string, options?: string | ToastOptions) => showToast("warning", title, options),
};
