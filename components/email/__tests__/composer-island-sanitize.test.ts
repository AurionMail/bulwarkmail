import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import type { Editor as ReactEditor } from '@tiptap/react';

import { QuotedHtml, serializeEditorContent } from '../quoted-html';
import { SignatureBlock, SIGNATURE_BLOCK_MARKER } from '../signature-block';

// A re-opened draft hands its stored HTML to the editor as is, and the quote
// and signature islands copy their inner HTML verbatim into the app document.
// A draft written by another client, or by another member of a shared
// mailbox, could carry event handlers that then ran in the webmail origin.

const PAYLOAD = '<img src="x" onerror="window.__xss = 1"><a href="javascript:alert(1)">l</a><script>window.__xss = 2</script><p>Quoted original</p>';

function mount(html: string): Editor {
  return new Editor({ extensions: [Document, Paragraph, Text, QuotedHtml, SignatureBlock], content: html });
}

function islandHtml(editor: Editor, selector: string): string {
  const host = editor.view.dom.querySelector(selector) as HTMLElement;
  return host.shadowRoot!.innerHTML;
}

function expectInert(html: string) {
  expect(html).not.toMatch(/onerror/i);
  expect(html).not.toMatch(/javascript:/i);
  expect(html).not.toMatch(/<script/i);
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('composer islands sanitize what they parse', () => {
  it('strips script vectors from a quoted original in a re-opened draft', () => {
    editor = mount(`<p>Hi</p><div data-quoted-html>${PAYLOAD}</div>`);
    const rendered = islandHtml(editor, '.quoted-html-island');
    expectInert(rendered);
    expect(rendered).toContain('Quoted original');
    expectInert(serializeEditorContent(editor as unknown as ReactEditor));
  });

  it('strips script vectors from a signature in a re-opened draft', () => {
    editor = mount(`<p>Hi</p><div ${SIGNATURE_BLOCK_MARKER}>${PAYLOAD}</div>`);
    const rendered = islandHtml(editor, `[${SIGNATURE_BLOCK_MARKER}]`);
    expectInert(rendered);
    expect(rendered).toContain('Quoted original');
    expectInert(serializeEditorContent(editor as unknown as ReactEditor));
  });

  it('keeps the composer markers the islands depend on', () => {
    editor = mount('<div data-quoted-html><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-cid="logo@x"></div>'
      + `<div ${SIGNATURE_BLOCK_MARKER}><div data-signature-block="start"></div>Jane<div data-signature-block="end"></div></div>`);
    const out = serializeEditorContent(editor as unknown as ReactEditor);
    expect(out).toContain('data-cid="logo@x"');
    expect(out).toContain('data-signature-block="start"');
    expect(out).toContain('data-signature-block="end"');
  });
});
