import { locales } from '@/i18n/routing';
import { IS_LITE } from '@/lib/lite';

/**
 * `generateStaticParams` inputs for the localized page tree.
 *
 * The static export must know every path up front, so in Lite the `[locale]`
 * layout enumerates the locales and each `[[...segments]]` page contributes
 * its bare surface (`/en/mail`, never `/en/mail/thread/x` - deep links are
 * resolved in the browser, see hooks/use-lite-link-segments.ts).
 *
 * The regular server build keeps every route on demand: an empty list means
 * "prerender nothing", and the root layout's `headers()` call makes the routes
 * dynamic anyway. Only the file exports change, not the runtime behaviour.
 */

/** Parses `LITE_LOCALES` ("de,en,fr") against the supported set; unknown or empty means all. */
export function pickLiteLocales(raw: string | undefined, all: readonly string[] = locales): string[] {
  const wanted = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length === 0) return [...all];
  const picked = all.filter((l) => wanted.includes(l));
  return picked.length > 0 ? picked : [...all];
}

export function liteLocaleParams(): Array<{ locale: string }> {
  if (!IS_LITE) return [];
  return pickLiteLocales(process.env.LITE_LOCALES).map((locale) => ({ locale }));
}

export function liteSegmentParams(): Array<{ segments: string[] }> {
  if (!IS_LITE) return [];
  return [{ segments: [] }];
}

/**
 * What the layouts/pages export as `generateStaticParams`.
 *
 * Next only treats the export as present when it is a function
 * (`typeof === 'function'`, build/segment-config/app/app-segments.js). An
 * `undefined` export is therefore identical to no export: the server build's
 * routes keep their dynamic (ƒ) mode instead of turning into SSG routes with
 * an empty path list, which would change how they are rendered and cached.
 */
export const generateLiteLocaleParams = IS_LITE ? liteLocaleParams : undefined;
export const generateLiteSegmentParams = IS_LITE ? liteSegmentParams : undefined;
