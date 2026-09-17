import { describe, it, expect } from 'vitest';
import {
  buildEmbeddedSignatureHtml,
  htmlComposeBodyToPlainText,
  plainComposeBodyToHtml,
  stripEmbeddedSignature,
} from '../compose-format';
import { SIGNATURE_BLOCK_MARKER, SIGNATURE_RANGE_MARKER, containsEmbeddedSignature } from '../signature-block';
import { plainTextBodyHasSignature } from '@/lib/signature-utils';

const identity = { htmlSignature: '<b>Alice</b><br>Acme', textSignature: 'Alice\nAcme' };
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('compose-format (#1022): HTML <-> plain text switch', () => {
  describe('stripEmbeddedSignature', () => {
    it('removes the marker-bracketed range and reports it', () => {
      const html = `<p>Hi</p>${buildEmbeddedSignatureHtml(identity, { embed: true, separator: true })}`;
      const out = stripEmbeddedSignature(html);
      expect(out.hadSignature).toBe(true);
      expect(out.html).toBe('<p>Hi</p>');
    });

    it('stops before the quote when the end marker is missing', () => {
      const html = `<p>Hi</p><p ${SIGNATURE_RANGE_MARKER}="separator">-- </p><p>Alice</p><blockquote>original</blockquote>`;
      const out = stripEmbeddedSignature(html);
      expect(out.hadSignature).toBe(true);
      expect(out.html).toBe('<p>Hi</p><blockquote>original</blockquote>');
    });

    it('leaves a body without markers untouched', () => {
      expect(stripEmbeddedSignature('<p>Hi</p>')).toEqual({ html: '<p>Hi</p>', hadSignature: false });
    });
  });

  describe('htmlComposeBodyToPlainText', () => {
    it('flattens formatting and carries the signature over as plain text', () => {
      const html = `<p>Hello <b>there</b></p><p>Second</p>${buildEmbeddedSignatureHtml(identity, { embed: true, separator: true })}`;
      const text = htmlComposeBodyToPlainText(html, identity, { separator: true });
      expect(text).toBe('Hello there\n\nSecond\n\n-- \nAlice\nAcme');
      expect(plainTextBodyHasSignature(text, identity)).toBe(true);
      expect(count(text, 'Alice')).toBe(1);
    });

    it('does not invent a signature for a body that had none (below-quote reply)', () => {
      const text = htmlComposeBodyToPlainText('<p>Thanks</p><blockquote>original</blockquote>', identity, { separator: true });
      expect(text).toBe('Thanks\n\noriginal');
      expect(plainTextBodyHasSignature(text, identity)).toBe(false);
    });

    it('honours the separator setting', () => {
      const html = `<p>Hi</p>${buildEmbeddedSignatureHtml(identity, { embed: true, separator: false })}`;
      expect(htmlComposeBodyToPlainText(html, identity, { separator: false })).toBe('Hi\n\nAlice\nAcme');
    });
  });

  describe('plainComposeBodyToHtml', () => {
    it('wraps paragraphs and re-embeds the signature with markers', () => {
      const html = plainComposeBodyToHtml('Hello\nthere\n\nSecond\n\n-- \nAlice\nAcme', identity, { separator: true });
      expect(html.startsWith('<p>Hello<br>there</p><p>Second</p>')).toBe(true);
      expect(containsEmbeddedSignature(html)).toBe(true);
      expect(count(html, SIGNATURE_BLOCK_MARKER)).toBe(1);
      expect(html).toContain('<b>Alice</b>');
      // The plain-text copy is gone - only the embedded HTML one remains.
      expect(count(html, 'Alice')).toBe(1);
    });

    it('keeps a body without signature signature-free', () => {
      const html = plainComposeBodyToHtml('Thanks\n\n> original', identity, { separator: true });
      expect(html).toBe('<p>Thanks</p><p>&gt; original</p>');
      expect(containsEmbeddedSignature(html)).toBe(false);
    });

    it('gives an untouched signature-only body an empty paragraph to type into', () => {
      const html = plainComposeBodyToHtml('\n\n-- \nAlice\nAcme', identity, { separator: true });
      expect(html.startsWith('<p></p>')).toBe(true);
      expect(containsEmbeddedSignature(html)).toBe(true);
    });
  });

  it('round-trips a compose body without duplicating or losing the signature', () => {
    const start = `<p>Draft text</p>${buildEmbeddedSignatureHtml(identity, { embed: true, separator: true })}`;
    const text = htmlComposeBodyToPlainText(start, identity, { separator: true });
    const back = plainComposeBodyToHtml(text, identity, { separator: true });
    expect(back).toBe(start);
  });
});
