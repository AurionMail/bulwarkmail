import { describe, it, expect } from 'vitest';
import { lookup, interpolate, localeChain, tablesFor, textDirection } from '../plugin-sandbox/plugin-i18n';

const tables = {
  en: { hello: 'Hello {name}', only_en: 'English only' },
  de: { hello: 'Hallo {name}' },
  'zh-TW': { hello: '你好 {name}' },
};

describe('plugin translations', () => {
  it('falls back from a regional locale to its language', () => {
    // de-CH used to skip straight to English.
    expect(lookup(tables, 'de-CH', 'hello')).toBe('Hallo {name}');
  });

  it('matches locale names regardless of case', () => {
    expect(lookup(tables, 'zh-tw', 'hello')).toBe('你好 {name}');
  });

  it('falls back to English, then reports a missing key', () => {
    expect(lookup(tables, 'de', 'only_en')).toBe('English only');
    expect(lookup(tables, 'de', 'missing')).toBeUndefined();
  });

  it('builds the chain most specific first', () => {
    expect(localeChain('pt-BR')).toEqual(['pt-BR', 'pt', 'en']);
  });

  it('hands a frame only the tables its locale can reach', () => {
    const all = { ...tables, fr: { hello: 'Bonjour {name}' }, ja: { hello: 'こんにちは' } };
    expect(Object.keys(tablesFor(all, 'de-CH'))).toEqual(['de', 'en']);
    expect(Object.keys(tablesFor(all, 'zh-tw'))).toEqual(['zh-TW', 'en']);
    expect(Object.keys(tablesFor(all, 'en'))).toEqual(['en']);
    expect(tablesFor(undefined, 'de')).toEqual({});
    // Whatever lookup finds in all tables, it finds in the trimmed ones.
    for (const locale of ['de-CH', 'zh-tw', 'fr', 'it']) {
      for (const key of ['hello', 'only_en', 'missing']) {
        expect(lookup(tablesFor(all, locale), locale, key)).toBe(lookup(all, locale, key));
      }
    }
  });

  it('fills placeholders', () => {
    expect(interpolate('Hallo {name}', { name: 'Ana' })).toBe('Hallo Ana');
  });
});

describe('textDirection', () => {
  it('is right-to-left for Arabic, Hebrew and Persian, with or without a region', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('he-IL')).toBe('rtl');
    expect(textDirection('fa')).toBe('rtl');
    expect(textDirection('de-CH')).toBe('ltr');
  });
});
