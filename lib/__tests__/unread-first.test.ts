import { describe, expect, it } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import { andFilters, isUnreadFirstView, mergeUnreadSection, withoutReached, type UnreadSection } from '../unread-first';

const mail = (id: string, threadId = `thread-${id}`) => ({ id, threadId, keywords: {} }) as Email;
const section = (...ids: string[]): UnreadSection => ({ mailboxId: 'inbox', ids: new Set(ids), total: ids.length });

describe('mergeUnreadSection', () => {
  it('puts the fresh section first and drops the rows that left it', () => {
    const list = [mail('u1'), mail('u2'), mail('r1'), mail('r2')];
    const merged = mergeUnreadSection(list, section('u1', 'u2'), [mail('u3'), mail('u1')], null);
    expect(merged.emails.map((e) => e.id)).toEqual(['u3', 'u1', 'r1', 'r2']);
    expect([...merged.ids]).toEqual(['u3', 'u1']);
  });

  it('keeps the open conversation\'s message that left the section', () => {
    const list = [mail('u1'), mail('u2', 'open'), mail('r1')];
    const merged = mergeUnreadSection(list, section('u1', 'u2'), [mail('u1')], 'open');
    expect(merged.emails.map((e) => e.id)).toEqual(['u1', 'u2', 'r1']);
    expect(merged.ids.has('u2')).toBe(true);
  });

  it('takes a row of the main list the section now has into the section', () => {
    const merged = mergeUnreadSection([mail('r1'), mail('r2')], section(), [mail('r2')], null);
    expect(merged.emails.map((e) => e.id)).toEqual(['r2', 'r1']);
  });
});

describe('withoutReached', () => {
  it('returns the same section when a page reached none of its rows', () => {
    const before = section('u1');
    expect(withoutReached(before, ['r1'])).toBe(before);
    expect([...withoutReached(before, ['u1'])!.ids]).toEqual([]);
  });
});

describe('andFilters', () => {
  it('ANDs two fragments and passes a lone one through', () => {
    expect(andFilters(null, { a: 1 })).toEqual({ a: 1 });
    expect(andFilters({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(andFilters({ a: 1 }, { b: 2 })).toEqual({ operator: 'AND', conditions: [{ a: 1 }, { b: 2 }] });
  });
});

describe('isUnreadFirstView', () => {
  const view = { interfaceLayout: 'mountain-view', mvInboxType: 'unread-first', mailboxRole: 'inbox', otherView: false } as const;
  it('is Mountain View\'s inbox with the inbox type set, and nothing else', () => {
    expect(isUnreadFirstView(view)).toBe(true);
    expect(isUnreadFirstView({ ...view, interfaceLayout: 'default' })).toBe(false);
    expect(isUnreadFirstView({ ...view, mvInboxType: 'default' })).toBe(false);
    expect(isUnreadFirstView({ ...view, mailboxRole: 'archive' })).toBe(false);
    expect(isUnreadFirstView({ ...view, otherView: true })).toBe(false);
  });
});
