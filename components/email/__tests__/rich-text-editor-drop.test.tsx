import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { Editor } from '@tiptap/core';

import { RichTextEditor } from '../rich-text-editor';

/** A drop from the desktop: the file plus its path as text, as Firefox sends it. */
function fileDrop(file: File) {
  const text = `file:///C:/Users/me/Downloads/${file.name}`;
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: [file],
      types: ['Files', 'text/uri-list', 'text/plain'],
      getData: (type: string) => (type === 'text/plain' || type === 'text/uri-list' ? text : ''),
    },
  });
  return event;
}

async function setup(onImageUpload?: (file: File) => Promise<{ src: string } | null>) {
  let editor: Editor | null = null;
  const onDrop = vi.fn();
  render(
    <div onDrop={onDrop}>
      <RichTextEditor
        content="<p>Hello</p>"
        onChange={() => {}}
        onImageUpload={onImageUpload}
        onEditorReady={(ed) => { editor = ed as unknown as Editor; }}
      />
    </div>
  );
  await waitFor(() => expect(editor).not.toBeNull());
  const ed = editor as unknown as Editor;
  // jsdom has no layout to resolve the drop point from.
  ed.view.posAtCoords = () => ({ pos: 1, inside: -1 });
  return { editor: ed, onDrop };
}

describe('RichTextEditor file drop', () => {
  it('does not insert the path of a dropped file, and leaves the file to the composer', async () => {
    const { editor, onDrop } = await setup(async () => ({ src: 'blob:x' }));
    const event = fileDrop(new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }));

    act(() => { editor.view.dom.dispatchEvent(event); });

    expect(editor.getText()).toBe('Hello');
    expect(event.defaultPrevented).toBe(true);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('does not insert the path when there is no inline image upload', async () => {
    const { editor, onDrop } = await setup();
    const event = fileDrop(new File(['png'], 'photo.png', { type: 'image/png' }));

    act(() => { editor.view.dom.dispatchEvent(event); });

    expect(editor.getText()).toBe('Hello');
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('still inlines a dropped image instead of attaching it', async () => {
    const upload = vi.fn(async () => ({ src: 'blob:x' }));
    const { editor, onDrop } = await setup(upload);
    const file = new File(['png'], 'photo.png', { type: 'image/png' });

    act(() => { editor.view.dom.dispatchEvent(fileDrop(file)); });

    expect(upload).toHaveBeenCalledWith(file);
    expect(editor.getText()).toBe('Hello');
    expect(onDrop).not.toHaveBeenCalled();
  });
});
