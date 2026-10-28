import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// German dates on the event card read "Sa, Okt 31, 2026": English order
// with translated names. Each locale now gets its own order.

let locale = 'en';
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => locale,
}));

import { useFormatEventDate } from '../use-format-event-date';

function formatIn(code: string, date: Date) {
  locale = code;
  const { result } = renderHook(() => useFormatEventDate());
  return result.current(date);
}

describe('useFormatEventDate', () => {
  const date = new Date(2026, 9, 31);

  it('keeps the English order in English', () => {
    expect(formatIn('en', date)).toBe('Sat, Oct 31, 2026');
  });

  it('puts the day before the month in German', () => {
    expect(formatIn('de', date)).toBe('Sa., 31. Okt. 2026');
  });

  it('follows French too', () => {
    expect(formatIn('fr', date)).toBe('sam. 31 oct. 2026');
  });
});
