"use client";

import { useSyncExternalStore } from 'react';
import { noThirdPartyTraffic, subscribeThirdPartyMode } from '@/lib/third-party-mode';

/**
 * Whether the browser must stay off built-in outside hosts (#903), as React
 * state: components re-render when the config arrives. True while the config
 * is still unknown, so nothing reaches out before it says it may.
 */
export function useNoThirdPartyTraffic(): boolean {
  return useSyncExternalStore(subscribeThirdPartyMode, noThirdPartyTraffic, () => true);
}
