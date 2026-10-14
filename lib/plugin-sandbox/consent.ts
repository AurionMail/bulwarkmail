// Queue for plugin permission-consent requests.
//
// On first enable the plugin store posts a ConsentRequest here; the
// `PluginConsentDialog` component renders the head and resolves the promise
// when the user accepts or rejects. The store persists the granted set in
// `plugin.grantedPermissions` so future enables don't re-prompt.

import type { Permission } from '../plugin-types';

export interface ConsentRequest {
  id: string;
  pluginId: string;
  pluginName: string;
  permissions: Permission[];
  /** Where the plugin may send data, shown under http:fetch / http:post. */
  httpOrigins?: string[];
  apiPostPaths?: string[];
  resolve: (granted: boolean) => void;
}

const queue: ConsentRequest[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function requestConsent(
  pluginId: string,
  pluginName: string,
  permissions: Permission[],
  targets: { httpOrigins?: string[]; apiPostPaths?: string[] } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({ id: uid(), pluginId, pluginName, permissions, ...targets, resolve });
    notify();
  });
}

export function head(): ConsentRequest | null {
  return queue[0] ?? null;
}

export function resolveHead(granted: boolean): void {
  const entry = queue.shift();
  if (!entry) return;
  try { entry.resolve(granted); } catch { /* ignore */ }
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
