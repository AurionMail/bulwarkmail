/**
 * The "no third-party traffic" mode (#903) as the browser sees it.
 *
 * The server reads the switch from config (lib/admin/third-party-mode.ts) and
 * hands it to the client through /api/config; Lite reads it from its
 * config.json. fetchConfig() stores it here, and every browser-side switch in
 * lib/outgoing-hosts.ts asks this module, so a component never has to thread
 * the flag through props to stay off an outside host.
 */

let enabled = false;

/** NO_THIRD_PARTY_TRAFFIC: true, 1, yes or on (any case) turn it on; anything else is off. */
export function parseNoThirdPartyEnv(value: string | undefined | null): boolean {
  return /^(true|1|yes|on)$/i.test((value ?? '').trim());
}

/** Called once the runtime config is known. */
export function setNoThirdPartyTraffic(on: boolean): void {
  enabled = on;
}

/** Whether the browser must stay off every built-in outside host. */
export function noThirdPartyTraffic(): boolean {
  return enabled;
}
