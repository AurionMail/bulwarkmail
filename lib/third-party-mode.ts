/**
 * The "no third-party traffic" mode (#903) as the browser sees it.
 *
 * The server reads the switch from config (lib/admin/third-party-mode.ts) and
 * hands it to the client through /api/config; Lite reads it from its
 * config.json. fetchConfig() stores it here, and every browser-side switch in
 * lib/outgoing-hosts.ts asks this module, so a component never has to thread
 * the flag through props to stay off an outside host.
 *
 * Fail closed: until the config has been read the state is "unknown", and
 * every blocking helper treats "unknown" like "on". Only a config that says
 * off opens the outside hosts.
 */

export type ThirdPartyModeState = 'unknown' | 'on' | 'off';

let state: ThirdPartyModeState = 'unknown';
const listeners = new Set<() => void>();

/** NO_THIRD_PARTY_TRAFFIC: true, 1, yes or on (any case) turn it on; anything else is off. */
export function parseNoThirdPartyEnv(value: string | undefined | null): boolean {
  return /^(true|1|yes|on)$/i.test((value ?? '').trim());
}

/** A config value (boolean, or a string as in env) as on or off. */
export function parseNoThirdPartyValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && parseNoThirdPartyEnv(value);
}

/** Called once the runtime config is known; 'unknown' goes back to the start state. */
export function setNoThirdPartyTraffic(on: boolean | 'unknown'): void {
  const next: ThirdPartyModeState = on === 'unknown' ? 'unknown' : on ? 'on' : 'off';
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function thirdPartyModeState(): ThirdPartyModeState {
  return state;
}

/** Whether the browser must stay off every built-in outside host: on, or not known yet. */
export function noThirdPartyTraffic(): boolean {
  return state !== 'off';
}

/** For useSyncExternalStore (hooks/use-third-party-mode.ts). */
export function subscribeThirdPartyMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
