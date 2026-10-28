import { NextResponse } from 'next/server';
import { configManager } from './config-manager';
import { parseNoThirdPartyEnv, parseNoThirdPartyValue } from '@/lib/third-party-mode';

/**
 * The "no third-party traffic" switch (#903) on the server.
 *
 * It is config, not policy: instance-wide, because most of what it stops
 * (telemetry, the version check, the extension directory) runs for no
 * particular user. NO_THIRD_PARTY_TRAFFIC in the environment wins over
 * config.json in one direction only: an env "on" can't be switched off from
 * the admin panel, so a deployment that pins it stays closed.
 */

export type NoThirdPartySource = 'env' | 'admin' | 'default';

export function noThirdPartyTrafficState(): { on: boolean; source: NoThirdPartySource } {
  if (parseNoThirdPartyEnv(process.env.NO_THIRD_PARTY_TRAFFIC)) return { on: true, source: 'env' };
  const entry = configManager.getAllWithSources().noThirdPartyTraffic;
  // config.json may hold "true", "1", "yes" or "on" as a string.
  const on = parseNoThirdPartyValue(entry?.value);
  return { on, source: entry?.source === 'admin' ? 'admin' : on ? 'env' : 'default' };
}

/** Whether every built-in outside host is off. Loads the config first. */
export async function isNoThirdPartyTrafficOn(): Promise<boolean> {
  if (parseNoThirdPartyEnv(process.env.NO_THIRD_PARTY_TRAFFIC)) return true;
  await configManager.ensureLoaded();
  return parseNoThirdPartyValue(configManager.get<unknown>('noThirdPartyTraffic', false));
}

/** The answer a route gives instead of contacting an outside host. */
export function thirdPartyRefusal(what: string): NextResponse {
  return NextResponse.json(
    { error: `${what} is off: this server doesn't contact outside services (NO_THIRD_PARTY_TRAFFIC).`, code: 'no-third-party-traffic' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}
