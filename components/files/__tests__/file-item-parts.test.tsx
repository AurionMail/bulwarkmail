import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

let appLocale = 'ar';
vi.mock('@/i18n/detect-locale', () => ({ getEffectiveLocale: () => appLocale }));

import { FileSize, formatFullDate, formatShortDate } from '../file-item-parts';

// The browser here is en-US; the app's language must win.
describe('Files list dates and sizes', () => {
  afterEach(() => { appLocale = 'ar'; });

  it('writes dates in the app language, not the browser one', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(formatShortDate('2026-03-05T10:00:00Z', now)).toMatch(/مارس/);
    expect(formatFullDate('2026-03-05T10:00:00Z')).toMatch(/مارس/);
    appLocale = 'de';
    expect(formatShortDate('2026-03-05T10:00:00Z', now)).toMatch(/März/);
  });

  it('keeps the number before the unit in a right-to-left layout', () => {
    const { container } = render(<div dir="rtl"><FileSize bytes={6861} /></div>);
    const size = container.querySelector('bdi')!;
    expect(size).toHaveAttribute('dir', 'ltr');
    expect(size.textContent).toBe('6.7 KB');
  });
});
