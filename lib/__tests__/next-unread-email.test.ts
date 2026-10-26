import { describe, it, expect } from 'vitest';
import { findNextUnreadIndex } from '../next-unread-email';

// #514: `n` opens the next unread message below the current one.

const mail = (id: string, seen: boolean): { id: string; keywords: Record<string, boolean> } =>
  ({ id, keywords: seen ? { $seen: true } : {} });

describe('findNextUnreadIndex', () => {
  const list = [mail('a', false), mail('b', true), mail('c', true), mail('d', false), mail('e', true)];

  it('finds the first unread message after the current one', () => {
    expect(findNextUnreadIndex(list, 'b')).toBe(3);
  });

  it('skips the current message even when it is unread', () => {
    expect(findNextUnreadIndex(list, 'a')).toBe(3);
  });

  it('starts at the top when nothing is open', () => {
    expect(findNextUnreadIndex(list, undefined)).toBe(0);
    expect(findNextUnreadIndex(list, null)).toBe(0);
  });

  it('starts at the top when the open message is not in the list', () => {
    expect(findNextUnreadIndex(list, 'gone')).toBe(0);
  });

  it('does not wrap around to unread mail above', () => {
    expect(findNextUnreadIndex(list, 'd')).toBe(-1);
    expect(findNextUnreadIndex(list, 'e')).toBe(-1);
  });

  it('treats a message without keywords as unread', () => {
    const rows = [mail('a', true), { id: 'b' } as { id: string; keywords: Record<string, boolean> }];
    expect(findNextUnreadIndex(rows, 'a')).toBe(1);
  });

  it('returns -1 for an empty or all-read list', () => {
    expect(findNextUnreadIndex([], undefined)).toBe(-1);
    expect(findNextUnreadIndex([mail('a', true), mail('b', true)], undefined)).toBe(-1);
  });
});
