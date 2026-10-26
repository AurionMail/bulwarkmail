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

const serialize = (editor: Editor) => serializeEditorContent(editor).replace(/ dir="auto"/g, '');

describe('RichTextEditor paragraph spacing (#1340)', () => {
  it('sends each line with the 4px margin the composer shows, not the 1em default', async () => {
    const editor = await setup('<p>one</p><p>two</p>');

    expect(serialize(editor)).toBe('<p style="margin:4px 0;">one</p><p style="margin:4px 0;">two</p>');
  });

  it('keeps the alignment next to the margin', async () => {
    const editor = await setup('<p style="text-align: center">mid</p>');

    expect(serialize(editor)).toBe('<p style="margin:4px 0;text-align: center;">mid</p>');
  });

  it('spaces paragraphs in lists too', async () => {
    const editor = await setup('<ul><li><p>a</p></li></ul>');

    expect(serialize(editor)).toContain('<li><p style="margin:4px 0;">a</p></li>');
  });

  it('sends no margin inside a table, as the composer shows none there', async () => {
    const editor = await setup('<table><tbody><tr><td><p>cell</p></td></tr></tbody></table>');

    expect(serialize(editor)).toContain('<p style="margin:0;">cell</p>');
  });

  it('does not stack margins when a saved draft is opened again', async () => {
    const editor = await setup('<p style="text-align: right">one</p><p>two</p>');
    const saved = serialize(editor);

    act(() => { editor.commands.setContent(saved, { emitUpdate: false }); });

    expect(serialize(editor)).toBe(saved);
  });

  it('leaves the quoted original alone', async () => {
    const editor = await setup('<p>reply</p><div data-quoted-html=""><p>quoted</p></div>');

    expect(serialize(editor)).toContain('<p>quoted</p>');
  });
});
