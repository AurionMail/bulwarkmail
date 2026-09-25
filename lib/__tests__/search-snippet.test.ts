import { describe, expect, it } from 'vitest';
import {
  attachSearchSnippets,
  filterHasSnippetTerms,
  hasMarkedSegment,
  parseSearchSnippet,
  snippetFilterFor,
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

  it('leaves a lone wildcard alone', () => {
    expect(snippetFilterFor({ text: '*' })).toEqual({ text: '*' });
  });

  it('unquotes phrases: one quoted term puts the whole request in exact mode on Stalwart 0.16 and 1.0', () => {
    expect(
      snippetFilterFor({
        operator: 'AND',
        conditions: [
          { text: '"annual report"' },
          { text: '2024' },
          { subject: "'draft'" },
          { from: '"Anna Muster"' },
          { inMailbox: 'x' },
        ],
      }),
    ).toEqual({
      operator: 'AND',
      conditions: [
        { text: 'annual report' },
        { text: '2024' },
        { subject: 'draft' },
        { from: '"Anna Muster"' },
        { inMailbox: 'x' },
      ],
    });
    expect(snippetFilterFor({ body: '"exact phrase"' })).toEqual({ body: 'exact phrase' });
    // Only a value wrapped in quotes is a phrase.
    expect(snippetFilterFor({ text: 'say "hi" twice' })).toEqual({ text: 'say "hi" twice' });
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
