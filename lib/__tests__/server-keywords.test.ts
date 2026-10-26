import { describe, it, expect } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import { generateEmailSource } from '@/lib/email-source';
import { emailToReadView } from '@/lib/plugin-projection';
import { isServerSetKeyword } from '@/lib/jmap/server-keywords';

// Stalwart 1.0 puts `$hasattachment` or `$hasnoattachment` on every message and
// derives hasAttachment from it. Where keywords are listed they would only
// repeat hasAttachment, so they are left out; 0.16 never sets them.

function makeEmail(keywords: Record<string, boolean>, hasAttachment: boolean): Email {
  return {
    id: 'm1',
    threadId: 't1',
    mailboxIds: { inbox: true },
    keywords,
    size: 2048,
    receivedAt: '2026-09-25T10:00:00Z',
    from: [{ name: 'Ann', email: 'ann@example.org' }],
    to: [{ name: '', email: 'bob@example.org' }],
    subject: 'Report',
    preview: 'See attached',
    hasAttachment,
    textBody: [{ partId: '1', blobId: 'b1', size: 12, type: 'text/plain' }],
    htmlBody: [],
    bodyValues: { '1': { value: 'See attached', isEncodingProblem: false, isTruncated: false } },
  } as unknown as Email;
}

describe('isServerSetKeyword', () => {
  it('matches the two attachment keywords in any case, and nothing else', () => {
    expect(isServerSetKeyword('$hasattachment')).toBe(true);
    expect(isServerSetKeyword('$hasnoattachment')).toBe(true);
    expect(isServerSetKeyword('$HasAttachment')).toBe(true);
    expect(isServerSetKeyword('$seen')).toBe(false);
    expect(isServerSetKeyword('$label:hasattachment')).toBe(false);
  });
});

describe('server-set keywords in listings', () => {
  it('leaves them out of the view-source keyword line on Stalwart 1.0', () => {
    const source = generateEmailSource(makeEmail({ $seen: true, '$label:work': true, $hasattachment: true }, true));
    expect(source).toContain('Has Attachment: Yes\n');
    expect(source).toContain('Keywords: $seen, $label:work\n');
    expect(source).not.toContain('$hasattachment');
  });

  it('drops the keyword line when the attachment keyword is the only one on Stalwart 1.0', () => {
    const source = generateEmailSource(makeEmail({ $hasnoattachment: true }, false));
    expect(source).toContain('Has Attachment: No\n');
    expect(source).not.toContain('Keywords:');
  });

  it('keeps the plugin projection keywords to what the user set, with hasAttachment intact', () => {
    const view = emailToReadView(makeEmail({ $seen: true, $hasattachment: true, $flagged: false }, true));
    expect(view.keywords).toEqual(['$seen']);
    expect(view.hasAttachment).toBe(true);
    expect(view.source).not.toContain('$hasattachment');
  });

  it('lists keywords unchanged on Stalwart 0.16, which never sets them', () => {
    const email = makeEmail({ $seen: true, '$label:work': true }, true);
    expect(emailToReadView(email).keywords).toEqual(['$seen', '$label:work']);
    expect(generateEmailSource(email)).toContain('Keywords: $seen, $label:work\n');
  });
});
