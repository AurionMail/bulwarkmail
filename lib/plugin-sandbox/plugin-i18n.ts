// Translation lookup for plugin strings (api.i18n.t). Pure, so the runtime
// inside the sandbox and the tests share it.

import { getLocaleDirection } from '@/i18n/direction';

export type LocaleTables = Record<string, Record<string, string>>;

/** Text direction for a locale tag, `ar-EG` included. */
export function textDirection(locale: string): 'ltr' | 'rtl' {
  return getLocaleDirection((locale || 'en').split('-')[0].toLowerCase());
}

/**
 * Locales to try for `locale`, most specific first: `de-CH` → `de-CH`, `de`,
 * then `en`. Matching ignores case (`zh-tw` finds `zh-TW`).
 */
export function localeChain(locale: string): string[] {
  const chain: string[] = [];
  const parts = (locale || 'en').split('-');
  for (let i = parts.length; i > 0; i--) chain.push(parts.slice(0, i).join('-'));
  if (!chain.includes('en')) chain.push('en');
  return chain;
}

function findTable(tables: LocaleTables, locale: string): Record<string, string> | undefined {
  if (tables[locale]) return tables[locale];
  const lower = locale.toLowerCase();
  const key = Object.keys(tables).find((k) => k.toLowerCase() === lower);
  return key ? tables[key] : undefined;
}

/**
 * The tables `lookup` can reach for `locale`. A plugin frame gets only these
 * (and the next ones with a locale change), not every language the plugin
 * ships: those were most of each init message, copied again in every frame.
 */
export function tablesFor(tables: LocaleTables | undefined, locale: string): LocaleTables {
  const out: LocaleTables = {};
  if (!tables) return out;
  for (const loc of localeChain(locale)) {
    const lower = loc.toLowerCase();
    const key = tables[loc] ? loc : Object.keys(tables).find((k) => k.toLowerCase() === lower);
    if (key) out[key] = tables[key];
  }
  return out;
}

/** The text for `key`, or undefined when no table has it. */
export function lookup(tables: LocaleTables, locale: string, key: string): string | undefined {
  for (const loc of localeChain(locale)) {
    const value = findTable(tables, loc)?.[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** Replace `{name}` placeholders. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v));
  return out;
}
