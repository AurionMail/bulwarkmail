import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, BackgroundColor } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';

import { FontSize, FONT_SIZES } from '../font-size';

// Mirrors the composer's registration order for TextStyle-based marks
// (rich-text-editor.tsx): TextStyle first, then the attribute extensions.
function makeEditor(content = '<p>Hello world</p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TextStyle, Color, BackgroundColor, FontSize],
    content,
  });
}

describe('font-size extension', () => {
  it('applies font-size as an inline style on the selection', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('18px');
    expect(editor.getHTML()).toContain('font-size: 18px');
    editor.destroy();
  });

  it('reports the active size via the textStyle attributes', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('24px');
    expect(editor.getAttributes('textStyle').fontSize).toBe('24px');
    editor.destroy();
  });

  it('unsetFontSize removes the attribute and the empty textStyle mark', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('18px');
    editor.commands.unsetFontSize();
    expect(editor.getAttributes('textStyle').fontSize).toBeUndefined();
    expect(editor.getHTML()).not.toContain('font-size');
    editor.destroy();
  });

  it('parses font-size from pasted inline styles', () => {
    const editor = makeEditor('<p><span style="font-size: 32px">Big</span> rest</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(editor.getAttributes('textStyle').fontSize).toBe('32px');
    editor.destroy();
  });

  it('keeps color and font-size on the same span', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('18px');
    editor.commands.setColor('#c5221f');
    const html = editor.getHTML();
    expect(html).toContain('font-size: 18px');
    // jsdom's DOM serializer normalizes #c5221f to rgb() form; either way the
    // colour declaration must be on the same span as the size.
    expect(html).toContain('color: rgb(197, 34, 31)');
    // Removing the size must keep the colour, not the whole mark.
    editor.commands.unsetFontSize();
    const after = editor.getHTML();
    expect(after).not.toContain('font-size');
    expect(after).toContain('color: rgb(197, 34, 31)');
    editor.destroy();
  });

  it('exposes the toolbar size presets the UI renders', () => {
    expect([...FONT_SIZES]).toEqual(['14px', '16px', '18px', '20px', '24px', '32px']);
  });
});

describe('background-color extension', () => {
  it('applies background-color as an inline style on the selection', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setBackgroundColor('#fef3c7');
    const html = editor.getHTML();
    // jsdom normalizes #fef3c7 to rgb() form.
    expect(html).toContain('background-color: rgb(254, 243, 199)');
    editor.destroy();
  });

  it('reports the active tint via the textStyle attributes', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setBackgroundColor('#dcfce7');
    // getAttributes returns the stored attribute verbatim (no jsdom
    // round-trip), unlike getHTML which normalizes to rgb() form.
    expect(editor.getAttributes('textStyle').backgroundColor).toBe('#dcfce7');
    editor.destroy();
  });

  it('unsetBackgroundColor removes the attribute and the empty textStyle mark', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setBackgroundColor('#dbeafe');
    editor.commands.unsetBackgroundColor();
    expect(editor.getHTML()).not.toContain('background-color');
    editor.destroy();
  });

  it('parses background-color from pasted inline styles', () => {
    const editor = makeEditor('<p><span style="background-color: #fde68a">Marked</span> rest</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    // parseHTML reads the raw style attribute, so the hex form survives.
    expect(editor.getAttributes('textStyle').backgroundColor).toBe('#fde68a');
    editor.destroy();
  });

  it('keeps color, background-color and font-size on the same span', () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('18px');
    editor.commands.setColor('#c5221f');
    editor.commands.setBackgroundColor('#fef3c7');
    const html = editor.getHTML();
    expect(html).toContain('font-size: 18px');
    expect(html).toContain('color: rgb(197, 34, 31)');
    expect(html).toContain('background-color: rgb(254, 243, 199)');
    // Removing the tint must keep the other two attributes.
    editor.commands.unsetBackgroundColor();
    const after = editor.getHTML();
    expect(after).not.toContain('background-color');
    expect(after).toContain('font-size: 18px');
    expect(after).toContain('color: rgb(197, 34, 31)');
    editor.destroy();
  });
});
