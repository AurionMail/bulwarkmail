import { describe, it, expect } from 'vitest';
import { formatContactDate } from '../contact-dates';

describe('contact dates in the UI language', () => {
  it('writes a birthday the German way in German, not "Mar 15 1988"', () => {
    expect(formatContactDate({ year: 1988, month: 3, day: 15 }, 'de')).toBe('15. März 1988');
    expect(formatContactDate('1988-03-15', 'de')).toBe('15. März 1988');
  });

  it('leaves out what the date does not name', () => {
    expect(formatContactDate('--03-15', 'en')).toBe('March 15');
    expect(formatContactDate({ year: 1988 }, 'en')).toBe('1988');
    expect(formatContactDate('--02-29', 'fr')).toBe('29 février');
  });
});
