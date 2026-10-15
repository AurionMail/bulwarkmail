import { describe, expect, it } from 'vitest';
import {
  attachSearchSnippets,
  filterHasSnippetTerms,
  hasMarkedSegment,
  parseSearchSnippet,
  snippetFilterFor,
  withSearchSnippets,
} from '../search-snippet';
import type { Email } from '@/lib/jmap/types';

describe('parseSearchSnippet', () => {
  it('splits marked and plain segments and decodes the escaped text', () => {
    const segments = parseSearchSnippet('Re: <mark>Invoice</mark> &amp; receipt &lt;2026&gt;');
    expect(segments).toEqual([
      { text: 'Re: ', marked: false },
      { text: 'Invoice', marked: true },
      { text: ' & receipt <2026>', marked: false },
    ]);
    expect(hasMarkedSegment(segments)).toBe(true);
  });

  it('treats any other tag as literal text', () => {
    const segments = parseSearchSnippet('<script>x</script> <mark>hit</mark><b>bold</b>');
    expect(segments).toEqual([
      { text: '<script>x</script> ', marked: false },
      { text: 'hit', marked: true },
      { text: '<b>bold</b>', marked: false },
    ]);
  });

  it('reports no highlight for a snippet without marks', () => {
    const segments = parseSearchSnippet('plain subject');
    expect(segments).toEqual([{ text: 'plain subject', marked: false }]);
    expect(hasMarkedSegment(segments)).toBe(false);
  });
});

describe('filterHasSnippetTerms', () => {
  it('finds text/subject/body terms at any nesting level', () => {
    expect(filterHasSnippetTerms({ text: 'foo' })).toBe(true);
    expect(filterHasSnippetTerms({ operator: 'AND', conditions: [{ inMailbox: 'x' }, { subject: 'foo' }] })).toBe(true);
    expect(
      filterHasSnippetTerms({
        operator: 'AND',
        conditions: [{ inMailbox: 'x' }, { operator: 'NOT', conditions: [{ body: 'foo' }] }],
      }),
    ).toBe(true);
  });

  it('ignores structural-only filters and empty terms', () => {
    expect(filterHasSnippetTerms(undefined)).toBe(false);
    expect(filterHasSnippetTerms({ inMailbox: 'x', hasKeyword: '$seen' })).toBe(false);
    expect(filterHasSnippetTerms({ from: 'alice' })).toBe(false);
    expect(filterHasSnippetTerms({ text: '   ' })).toBe(false);
  });
});

describe('snippetFilterFor', () => {
  it('strips the prefix-search wildcard from highlightable terms only', () => {
    expect(
      snippetFilterFor({
        operator: 'AND',
        conditions: [{ inMailbox: 'x' }, { text: 'inv* rece*' }, { from: 'ali*' }],
      }),
    ).toEqual({
      operator: 'AND',
      conditions: [{ inMailbox: 'x' }, { text: 'inv rece' }, { from: 'ali*' }],
    });
  });

  it('leaves a lone wildcard and quoted phrases alone', () => {
    expect(snippetFilterFor({ text: '*' })).toEqual({ text: '*' });
    expect(snippetFilterFor({ subject: '"exact phrase"' })).toEqual({ subject: '"exact phrase"' });
  });
});

describe('attachSearchSnippets', () => {
  const email = (id: string): Email => ({ id, subject: `s-${id}` }) as Email;

  it('attaches snippets by email id and drops ones without a highlight', () => {
    const emails = [email('a'), email('b'), email('c')];
    attachSearchSnippets(emails, [
      { emailId: 'a', subject: '<mark>hit</mark> a', preview: null },
      { emailId: 'b', subject: 's-b', preview: 'nothing marked' },
      { emailId: 'c', subject: null, preview: 'body <mark>hit</mark>' },
    ]);
    expect(emails[0].searchSnippet).toEqual({ subject: '<mark>hit</mark> a', preview: null });
    expect(emails[1].searchSnippet).toBeUndefined();
    expect(emails[2].searchSnippet).toEqual({ subject: null, preview: 'body <mark>hit</mark>' });
  });

  it('is a no-op without snippets', () => {
    const emails = [email('a')];
    attachSearchSnippets(emails, undefined);
    attachSearchSnippets(emails, []);
    expect(emails[0].searchSnippet).toBeUndefined();
  });
});

describe('withSearchSnippets', () => {
  const email = (id: string, accountId?: string) => ({ id, subject: `Subject ${id}`, accountId }) as unknown as Email;
  const marked = (emailId: string) => ({ emailId, subject: `<mark>Subject</mark> ${emailId}`, preview: null });

  it('returns new objects only for the emails that gained a snippet', () => {
    const emails = [email('e1'), email('e2')];
    const next = withSearchSnippets(emails, [{ list: [marked('e2')] }]);

    expect(next).not.toBe(emails);
    expect(next[0]).toBe(emails[0]);
    expect(next[1]).not.toBe(emails[1]);
    expect(next[1].searchSnippet).toEqual({ subject: '<mark>Subject</mark> e2', preview: null });
    // The list already on screen is left untouched.
    expect(emails[1].searchSnippet).toBeUndefined();
  });

  it('returns the same list when nothing is highlighted', () => {
    const emails = [email('e1')];
    expect(withSearchSnippets(emails, [])).toBe(emails);
    expect(withSearchSnippets(emails, [{ list: [] }])).toBe(emails);
    expect(withSearchSnippets(emails, [{ list: [{ emailId: 'e1', subject: 'Subject e1', preview: null }] }])).toBe(emails);
    expect(withSearchSnippets(emails, [{ list: [marked('other')] }])).toBe(emails);
  });

  it("keeps each account's snippets to its own rows, since ids repeat across accounts", () => {
    const emails = [email('a', 'own'), email('a', 'group')];
    const next = withSearchSnippets(emails, [{ accountId: 'group', list: [marked('a')] }]);

    expect(next[0]).toBe(emails[0]);
    expect(next[1].searchSnippet?.subject).toBe('<mark>Subject</mark> a');
  });
});
