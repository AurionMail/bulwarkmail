import { beforeEach, describe, expect, it } from 'vitest';
import {
  liteSegmentsFromPath,
  liteSurfaceRootFor,
  parseLitePath,
  stashPendingLitePath,
  takePendingLitePath,
} from '@/lib/lite-link-segments';
import { LITE_PENDING_PATH_KEY } from '@/lib/lite';

describe('parseLitePath', () => {
  it('splits locale, surface and the remaining segments', () => {
    expect(parseLitePath('/en/mail/thread/abc')).toEqual({ locale: 'en', surface: 'mail', segments: ['thread', 'abc'] });
    expect(parseLitePath('/de/calendar/week/2026-09-17/')).toEqual({ locale: 'de', surface: 'calendar', segments: ['week', '2026-09-17'] });
    expect(parseLitePath('/zh-TW/settings/reading')).toEqual({ locale: 'zh-TW', surface: 'settings', segments: ['reading'] });
  });

  it('treats the locale root as the mail surface with no segments', () => {
    expect(parseLitePath('/en/')).toEqual({ locale: 'en', surface: 'mail', segments: [] });
    expect(parseLitePath('/en')).toEqual({ locale: 'en', surface: 'mail', segments: [] });
  });

  it('ignores query and hash and decodes each segment exactly once', () => {
    expect(parseLitePath('/en/contacts/card/a%2Fb?x=1#y')).toEqual({ locale: 'en', surface: 'contacts', segments: ['card', 'a/b'] });
    expect(parseLitePath('/en/files/folder/100%25')).toEqual({ locale: 'en', surface: 'files', segments: ['folder', '100%'] });
    // A broken escape is passed through verbatim rather than throwing.
    expect(parseLitePath('/en/files/folder/%E0%A4%A')).toEqual({ locale: 'en', surface: 'files', segments: ['folder', '%E0%A4%A'] });
  });

  it('strips a sub-path mount prefix first', () => {
    expect(parseLitePath('/webmail/fr/mail/message/m1', '/webmail')).toEqual({ locale: 'fr', surface: 'mail', segments: ['message', 'm1'] });
    expect(parseLitePath('/webmail', '/webmail')).toEqual({ locale: null, surface: 'mail', segments: [] });
    // A different first segment that merely shares the prefix text is not the prefix.
    expect(parseLitePath('/webmailer/en/mail', '/webmail').surface).toBeNull();
  });

  it('returns no surface for login, pro and unknown paths', () => {
    expect(parseLitePath('/en/login').surface).toBeNull();
    expect(parseLitePath('/en/pro').surface).toBeNull();
    expect(parseLitePath('/nonsense/deep').surface).toBeNull();
    expect(parseLitePath('/nonsense/deep').locale).toBeNull();
  });
});

describe('liteSegmentsFromPath', () => {
  it('only yields segments for the surface that is asking', () => {
    expect(liteSegmentsFromPath('/en/mail/thread/t1', 'mail')).toEqual(['thread', 't1']);
    expect(liteSegmentsFromPath('/en/mail/thread/t1', 'calendar')).toEqual([]);
    expect(liteSegmentsFromPath('/en/', 'mail')).toEqual([]);
    expect(liteSegmentsFromPath('/en/login', 'mail')).toEqual([]);
  });
});

describe('liteSurfaceRootFor (404 shim target)', () => {
  it('points a deep link at its surface shell, keeping locale and mount prefix', () => {
    expect(liteSurfaceRootFor('/en/mail/thread/t1')).toBe('/en/mail/');
    expect(liteSurfaceRootFor('/webmail/de/files/folder/x', '/webmail')).toBe('/webmail/de/files/');
  });

  it('returns null when there is nothing to replay', () => {
    expect(liteSurfaceRootFor('/en/login')).toBeNull();
    expect(liteSurfaceRootFor('/totally/unknown')).toBeNull();
    // No locale in the URL: the shells are locale-prefixed, so nothing to load.
    expect(liteSurfaceRootFor('/mail/thread/x')).toBeNull();
  });
});

describe('pending path hand-off', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('parks a link and hands it to the owning surface exactly once', () => {
    expect(stashPendingLitePath('/en/mail/thread/t1?x=1')).toBe(true);
    expect(sessionStorage.getItem(LITE_PENDING_PATH_KEY)).toBe('/en/mail/thread/t1?x=1');
    // Another surface leaves it alone.
    expect(takePendingLitePath('calendar')).toBeNull();
    expect(sessionStorage.getItem(LITE_PENDING_PATH_KEY)).toBe('/en/mail/thread/t1?x=1');
    expect(takePendingLitePath('mail')).toBe('/en/mail/thread/t1?x=1');
    expect(takePendingLitePath('mail')).toBeNull();
  });

  it('respects the mount prefix when matching the surface', () => {
    stashPendingLitePath('/webmail/en/contacts/card/c1');
    expect(takePendingLitePath('contacts')).toBeNull(); // without prefix: "webmail" is not a locale
    expect(takePendingLitePath('contacts', '/webmail')).toBe('/webmail/en/contacts/card/c1');
  });
});
