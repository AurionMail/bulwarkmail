import { describe, it, expect } from 'vitest';
import { findUnfilledPlaceholders, stripEmbeddedSignatureHtml } from '../placeholder-check';

describe('findUnfilledPlaceholders', () => {
  it('finds template placeholders in the subject and the body', () => {
    expect(findUnfilledPlaceholders('Follow-up: {{subject}}', 'Hi {{ recipient_name }},')).toEqual([
      '{{subject}}',
      '{{ recipient_name }}',
    ]);
  });

  it('finds upper-case fill-ins in brackets', () => {
    expect(findUnfilledPlaceholders('', 'See you at [TIME]. It costs [PRICE] per [UNIT_NAME].'))
      .toEqual(['[TIME]', '[PRICE]', '[UNIT_NAME]']);
    expect(findUnfilledPlaceholders('', 'Best regards, [YOUR NAME]')).toEqual(['[YOUR NAME]']);
    expect(findUnfilledPlaceholders('', 'Treffpunkt: [ÜBERGABEORT]')).toEqual(['[ÜBERGABEORT]']);
  });

  it('finds fill-ins that ask the sender to write something', () => {
    expect(findUnfilledPlaceholders('', 'Best regards,\n[Your Name]\n[Insert date]')).toEqual([
      '[Your Name]',
      '[Insert date]',
    ]);
    expect(findUnfilledPlaceholders('', 'Viele Grüße\n[Ihr Name], [Datum einfügen]')).toEqual([
      '[Ihr Name]',
      '[Datum einfügen]',
    ]);
  });

  it('finds unfinished-text markers', () => {
    expect(findUnfilledPlaceholders('', 'The venue is TBD. TODO: add the agenda. Room XXX')).toEqual([
      'TBD',
      'TODO',
      'XXX',
    ]);
  });

  it('reports a marker in brackets once', () => {
    expect(findUnfilledPlaceholders('', 'Agenda: [TODO]')).toEqual(['[TODO]']);
  });

  it('lists each placeholder once', () => {
    expect(findUnfilledPlaceholders('{{name}}', 'Hi {{name}}, at [TIME] or [TIME]?')).toEqual([
      '{{name}}',
      '[TIME]',
    ]);
  });

  it('leaves ordinary text alone', () => {
    const text = [
      'See footnote [1] and tick [x].',
      'Option [A] is fine, so is [3D] and [2026].',
      'I still have a todo list and the date is tba.',
      'Read [the docs](https://example.com) and [Your account](https://example.com/me).',
      'The mastodon handle is TODOS and the size is XXXL.',
      'Signed, [Yours truly].',
      'A {single} brace and {{}} are not placeholders.',
    ].join('\n');
    expect(findUnfilledPlaceholders('', text)).toEqual([]);
  });

  it('ignores bracket tags and markers in the subject', () => {
    expect(findUnfilledPlaceholders('Re: [EXTERNAL] Venue TBD', 'Thanks!')).toEqual([]);
  });
});

describe('stripEmbeddedSignatureHtml', () => {
  it('drops the bracketed signature range and keeps the rest', () => {
    const html = '<p>Hello</p><p data-signature-block="start"></p><p>[COMPANY] TODO</p><p data-signature-block="end"></p><p>After</p>';
    const stripped = stripEmbeddedSignatureHtml(html);
    expect(stripped).toContain('Hello');
    expect(stripped).toContain('After');
    expect(stripped).not.toContain('[COMPANY]');
  });

  it('drops a signature atom without range markers', () => {
    const html = '<p>Hello [TIME]</p><div data-signature-block-node="">[COMPANY]</div>';
    expect(stripEmbeddedSignatureHtml(html)).toBe('<p>Hello [TIME]</p>');
  });

  it('returns a body without a signature unchanged', () => {
    expect(stripEmbeddedSignatureHtml('<p>Hello</p>')).toBe('<p>Hello</p>');
  });
});
