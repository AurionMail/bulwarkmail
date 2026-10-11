import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Editor as ReactEditor } from '@tiptap/react';

import { QuotedHtml, buildQuotedHtmlBlock, serializeEditorContent } from '../quoted-html';

// A reply opened with the quoted original selected as a node. Tabbing from
// Subject into the body kept that selection, so the first key typed replaced
// the whole quote and the reply went out without it.

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mountReply(): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, QuotedHtml],
    content: `<p></p>${buildQuotedHtmlBlock('<p>Original message</p>')}`,
  });
}

function selectQuote(e: Editor) {
  let pos = -1;
  e.state.doc.descendants((node, p) => {
    if (node.type.name === 'quotedHtml') pos = p;
  });
  e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, pos)));
}

describe('QuotedHtml focus', () => {
  it('moves a selection resting on the quote to the start of the body on focus', () => {
    editor = mountReply();
    selectQuote(editor);

    editor.view.dom.dispatchEvent(new FocusEvent('focus'));

    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.from).toBe(1);
  });

  it('keeps the quote when the user types right after focusing', () => {
    editor = mountReply();
    selectQuote(editor);

    editor.view.dom.dispatchEvent(new FocusEvent('focus'));
    editor.commands.insertContent('Sure, numbers on Thursday.');

    const html = serializeEditorContent(editor as unknown as ReactEditor);
    expect(html).toContain('Sure, numbers on Thursday.');
    expect(html).toContain('Original message');
  });

  it('leaves a text selection alone', () => {
    editor = mountReply();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const before = editor.state.selection;

    editor.view.dom.dispatchEvent(new FocusEvent('focus'));

    expect(editor.state.selection.eq(before)).toBe(true);
  });
});
