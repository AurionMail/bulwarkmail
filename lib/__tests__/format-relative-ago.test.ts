import { describe, it, expect } from 'vitest';
import { formatRelativeAgo } from '../utils';

describe('formatRelativeAgo', () => {
  const now = new Date('2026-07-01T12:00:00Z');

  it('says how long ago in the largest whole unit', () => {
    expect(formatRelativeAgo(new Date('2026-07-01T11:57:00Z'), now)).toBe('3 minutes ago');
    expect(formatRelativeAgo(new Date('2026-07-01T08:00:00Z'), now)).toBe('4 hours ago');
    expect(formatRelativeAgo(new Date('2026-06-29T12:00:00Z'), now)).toBe('2 days ago');
  });

  it('says nothing once the message is a month old, or when the date is bad', () => {
    expect(formatRelativeAgo(new Date('2026-05-01T12:00:00Z'), now)).toBe('');
    expect(formatRelativeAgo('not a date', now)).toBe('');
  });
});
