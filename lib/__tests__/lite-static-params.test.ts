import { afterEach, describe, expect, it, vi } from 'vitest';
import { locales } from '@/i18n/routing';

const liteState = vi.hoisted(() => ({ IS_LITE: false }));
vi.mock('@/lib/lite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lite')>()),
  get IS_LITE() {
    return liteState.IS_LITE;
  },
}));

import { generateLiteLocaleParams, generateLiteSegmentParams, liteLocaleParams, liteSegmentParams, pickLiteLocales } from '@/lib/lite-static-params';

describe('lite static params', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    liteState.IS_LITE = false;
  });

  it('keeps the server build on demand: nothing is enumerated outside Lite', () => {
    expect(liteLocaleParams()).toEqual([]);
    expect(liteSegmentParams()).toEqual([]);
    // The page/layout exports are `undefined` outside Lite, which Next treats
    // as "no generateStaticParams" - the routes keep their dynamic mode.
    expect(generateLiteLocaleParams).toBeUndefined();
    expect(generateLiteSegmentParams).toBeUndefined();
  });

  it('enumerates every locale and the bare surface in Lite', () => {
    liteState.IS_LITE = true;
    expect(liteLocaleParams()).toEqual(locales.map((locale) => ({ locale })));
    expect(liteSegmentParams()).toEqual([{ segments: [] }]);
  });

  it('honours a LITE_LOCALES subset and ignores unknown entries', () => {
    liteState.IS_LITE = true;
    vi.stubEnv('LITE_LOCALES', ' de, en ,xx ');
    expect(liteLocaleParams()).toEqual([{ locale: 'de' }, { locale: 'en' }]);
  });

  it('falls back to all locales when the subset matches nothing', () => {
    expect(pickLiteLocales('xx,yy', ['en', 'de'])).toEqual(['en', 'de']);
    expect(pickLiteLocales('', ['en', 'de'])).toEqual(['en', 'de']);
    expect(pickLiteLocales(undefined, ['en', 'de'])).toEqual(['en', 'de']);
    expect(pickLiteLocales('de', ['en', 'de'])).toEqual(['de']);
  });
});
