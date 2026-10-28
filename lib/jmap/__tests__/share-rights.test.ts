import { describe, expect, it } from 'vitest';
import { detectPreset, MAILBOX_PRESETS } from '../share-rights';
import type { MailboxRights } from '../types';

// What Stalwart 1.0 and v1.0.0 return for a folder shared with the "read"
// preset (checked on the test servers, 2026-10-28): the keyword right comes
// back true with the seen right, and v1.0.0 adds maySetMetadata.
const READ_AS_STORED_BY_1_0 = {
  mayReadItems: true, mayAddItems: false, mayRemoveItems: false, maySetSeen: true,
  maySetKeywords: true, mayCreateChild: false, mayRename: false, maySubmit: false,
  mayDelete: false, mayShare: false, maySetMetadata: false,
} as MailboxRights;

describe('detectPreset', () => {
  it('reads a folder shared read-only on Stalwart 1.0 back as read only', () => {
    expect(detectPreset('mailbox', READ_AS_STORED_BY_1_0)).toBe('read');
  });

  it('still tells read and write apart', () => {
    expect(detectPreset('mailbox', { ...READ_AS_STORED_BY_1_0, mayAddItems: true, mayRemoveItems: true })).toBe('readWrite');
    expect(detectPreset('mailbox', MAILBOX_PRESETS.read)).toBe('read');
  });

  it('does not excuse a keyword right without the seen right', () => {
    expect(detectPreset('mailbox', { ...MAILBOX_PRESETS.read, maySetSeen: false, maySetKeywords: true })).toBe('custom');
  });

  it('ignores rights a newer server adds', () => {
    expect(detectPreset('addressBook', { mayRead: true, mayWrite: true, mayDelete: false, mayShare: false, maySetMetadata: false } as never)).toBe('readWrite');
  });
});
