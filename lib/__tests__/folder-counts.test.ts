import { describe, it, expect } from 'vitest';
import { resolveFolderCounts } from '@/lib/folder-counts';

// #982: a folder can override the global "show total count" setting.

const base = { unread: 3, total: 40, showTotalGlobally: true, mountainView: false };

describe('resolveFolderCounts', () => {
  it('follows the global setting without an override', () => {
    expect(resolveFolderCounts(base)).toEqual({ unread: 3, total: 40 });
    expect(resolveFolderCounts({ ...base, showTotalGlobally: false })).toEqual({ unread: 3, total: 0 });
  });

  it('keeps the Drafts total visible with the global total count off', () => {
    expect(resolveFolderCounts({
      unread: 0, total: 5, role: 'drafts', mode: 'all', showTotalGlobally: false, mountainView: false,
    })).toEqual({ unread: 0, total: 5 });
  });

  it('shows only unread with "unread", even with the global total count on', () => {
    expect(resolveFolderCounts({ ...base, mode: 'unread' })).toEqual({ unread: 3, total: 0 });
  });

  it('hides everything with "none"', () => {
    expect(resolveFolderCounts({ ...base, mode: 'none' })).toEqual({ unread: 0, total: 0 });
    expect(resolveFolderCounts({ ...base, mode: 'none', mountainView: true })).toEqual({ unread: 0, total: 0 });
  });

  it('treats an unknown synced value as no override', () => {
    expect(resolveFolderCounts({ ...base, showTotalGlobally: false, mode: 'bogus' })).toEqual({ unread: 3, total: 0 });
  });

  it('shows one number in Mountain View', () => {
    const mv = { ...base, mountainView: true };
    expect(resolveFolderCounts(mv)).toEqual({ unread: 3, total: 0 });
    expect(resolveFolderCounts({ ...mv, role: 'drafts' })).toEqual({ unread: 0, total: 40 });
    expect(resolveFolderCounts({ ...mv, mode: 'all' })).toEqual({ unread: 0, total: 40 });
    expect(resolveFolderCounts({ ...mv, role: 'drafts', mode: 'unread' })).toEqual({ unread: 3, total: 0 });
  });
});
