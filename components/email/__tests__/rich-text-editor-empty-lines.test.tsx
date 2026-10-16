import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import type { Editor } from '@tiptap/core';

import { RichTextEditor } from '../rich-text-editor';
import { serializeEditorContent } from '../quoted-html';

async function setup(content: string) {
  let editor: Editor | null = null;
  render(
    <RichTextEditor
      content={content}
      onChange={() => {}}
      onEditorReady={(ed) => { editor = ed as unknown as Editor; }}
    />
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return editor as unknown as Editor;
}

// The composer marks every block dir="auto"; that's not what these tests are about.
const serialize = (editor: Editor) => serializeEditorContent(editor).replace(/ dir="auto"/g, '');

// Re-open what was saved, the way a draft or a signature swap does.
function reload(editor: Editor, html: string) {
  act(() => { editor.commands.setContent(html, { emitUpdate: false }); });
}

describe('RichTextEditor empty lines (#1015)', () => {
  it('sends an empty line as a paragraph with a line break, so it keeps its height', async () => {
    const editor = await setup('<p>one</p><p></p><p></p><p>two</p>');

    expect(serialize(editor)).toBe('<p>one</p><p><br></p><p><br></p><p>two</p>');
  });

  it('does not add a line when the saved body is opened again', async () => {
    const editor = await setup('<p>one</p><p></p><p>two</p>');
    const saved = serialize(editor);

    reload(editor, saved);

    expect(editor.state.doc.child(1).type.name).toBe('paragraph');
    expect(editor.state.doc.child(1).childCount).toBe(0);
    expect(serialize(editor)).toBe(saved);
    reload(editor, serializeEditorContent(editor));
    expect(serialize(editor)).toBe(saved);
  });

  it('keeps a line break at the end of a line visible and stable', async () => {
    const editor = await setup('<p>one</p>');
    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }] }],
      }, { emitUpdate: false });
    });
    const saved = serialize(editor);
    expect(saved).toBe('<p>one<br><br></p>');

    reload(editor, saved);

    expect(editor.getJSON().content?.[0].content).toEqual([{ type: 'text', text: 'one' }, { type: 'hardBreak' }]);
    expect(serialize(editor)).toBe(saved);
  });

  it('leaves line breaks inside a line alone', async () => {
    const editor = await setup('<p>one<br>two</p>');

    expect(serialize(editor)).toBe('<p>one<br>two</p>');
  });

  it('does not touch the quoted original or the signature markers', async () => {
    const quoted = '<p>quoted</p><p></p><p>more</p>';
    const editor = await setup(
      '<p>reply</p><p></p>'
      + '<p data-signature-block="start"></p><p>Alice</p><p data-signature-block="end"></p>'
      + `<div data-quoted-html="">${quoted}</div>`,
    );

    const html = serialize(editor);

    expect(html).toBe(
      '<p>reply</p><p><br></p>'
      + '<p data-signature-block="start"></p><p>Alice</p><p data-signature-block="end"></p>'
      // The editor's own empty paragraph after the quote adds no line.
      + `<div data-quoted-html style="border-left:2px solid #c5c5c5;padding-left:12px;margin-top:8px;">${quoted}</div><p></p>`,
    );
  });

  it('adds no blank lines at the end of the message', async () => {
    const editor = await setup('<p>one</p><p></p><p>two</p><p></p><p></p>');

    expect(serialize(editor)).toBe('<p>one</p><p><br></p><p>two</p><p></p><p></p>');
  });
});
