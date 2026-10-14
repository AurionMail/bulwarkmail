import { describe, it, expect } from 'vitest';
import {
  buildEmbeddedSignatureHtml,
  htmlComposeBodyToPlainText,
  plainComposeBodyToHtml,
  replaceEmbeddedSignature,
  replacePlainTextSignature,
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

  it('adds no separator paragraph in front of a signature that has its own delimiter', () => {
    const html = buildEmbeddedSignatureHtml({ textSignature: '-- \nUser A' }, { embed: true, separator: true });
    expect(html).not.toContain(`${SIGNATURE_RANGE_MARKER}="separator"`);
    expect(count(html, '-- ')).toBe(1);
  });
});

describe('switching identity swaps the signature', () => {
  const other = { htmlSignature: '<i>Team</i>', textSignature: 'Team' };
  const none = { htmlSignature: '', textSignature: '' };
  const embed = (sig: typeof identity) => buildEmbeddedSignatureHtml(sig, { embed: true, separator: true });
  // The DOM writes valueless attributes as =""; compare in its spelling.
  const dom = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.innerHTML;

  describe('replaceEmbeddedSignature', () => {
    it('puts the new signature where the old one was', () => {
      const html = `<p>Hi</p>${embed(identity)}<blockquote>original</blockquote>`;
      expect(replaceEmbeddedSignature(html, embed(other)))
        .toBe(dom(`<p>Hi</p>${embed(other)}<blockquote>original</blockquote>`));
    });

    it('removes the signature for an identity without one', () => {
      const html = `<p>Hi</p>${embed(identity)}<blockquote>original</blockquote>`;
      expect(replaceEmbeddedSignature(html, embed(none))).toBe('<p>Hi</p><blockquote>original</blockquote>');
    });

    it('adds a signature above the quote when the body had none', () => {
      expect(replaceEmbeddedSignature('<p>Hi</p><blockquote>original</blockquote>', embed(other)))
        .toBe(dom(`<p>Hi</p>${embed(other)}<blockquote>original</blockquote>`));
    });

    it('keeps text typed on the line under the signature', () => {
      const typedBelow = embed(identity).replace(
        `<p ${SIGNATURE_RANGE_MARKER}="end"></p>`,
        `<p ${SIGNATURE_RANGE_MARKER}="end">P.S. see you</p>`,
      );
      expect(replaceEmbeddedSignature(`<p>Hi</p>${typedBelow}`, embed(none)))
        .toBe('<p>Hi</p><p>P.S. see you</p>');
      expect(replaceEmbeddedSignature(`<p>Hi</p>${typedBelow}`, embed(other)))
        .toBe(dom(`<p>Hi</p>${embed(other)}<p>P.S. see you</p>`));
    });

    it('adds a signature at the end when there is no quote', () => {
      expect(replaceEmbeddedSignature('<p>Hi</p>', embed(other))).toBe(dom(`<p>Hi</p>${embed(other)}`));
    });
  });

  describe('replacePlainTextSignature', () => {
    const signed = 'Hi\n\n-- \nAlice\nAcme';

    it('swaps a trailing signature', () => {
      expect(replacePlainTextSignature(signed, identity, other, { separator: true })).toBe('Hi\n\n-- \nTeam');
    });

    it('removes it for an identity without one and adds it back', () => {
      const bare = replacePlainTextSignature(signed, identity, none, { separator: true });
      expect(bare).toBe('Hi');
      expect(replacePlainTextSignature(bare, none, identity, { separator: true })).toBe(signed);
    });

    it('leaves a body alone whose signature the user edited', () => {
      const edited = 'Hi\n\n-- \nAlice (edited)';
      expect(replacePlainTextSignature(edited, identity, other, { separator: true })).toBe(edited);
    });
  });
});
