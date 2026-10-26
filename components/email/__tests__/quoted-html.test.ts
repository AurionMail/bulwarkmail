import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { buildQuotedHtmlBlock, QuotedHtml, serializeEditorContent } from '../quoted-html';

const createEditor = (content: string) => new Editor({ extensions: [StarterKit, QuotedHtml], content });

describe('HTML quote borders', () => {
  it('keeps normal quote styling by default', () => {
    const original = '<blockquote>Original reply</blockquote>';
    const editor = createEditor(buildQuotedHtmlBlock(original));
    try {
      expect(editor.view.dom.querySelector<HTMLElement>('.quoted-html-island')?.style.borderLeftWidth).toBe('2px');
      expect(serializeEditorContent(editor)).toContain(original);
    } finally { editor.destroy(); }
  });

  it('flattens nested quotes and preserves content and border preference after reopening', () => {
    const original = '<blockquote style="border-left:2px solid gray">Ok no problem<hr><blockquote>Hello this is a quick test<br><a href="mailto:max@example.com">Max</a></blockquote></blockquote><table><tbody><tr><td>Layout</td></tr></tbody></table>';
    const editor = createEditor(buildQuotedHtmlBlock(original, { showQuoteBorder: false }));
    let saved = '';
    try {
      const island = editor.view.dom.querySelector<HTMLElement>('.quoted-html-island')!;
      expect(island.style.borderLeftWidth).toBe('');
      expect(island.style.paddingLeft).toBe('');
      expect(island.shadowRoot?.querySelector('blockquote')).toBeNull();
      expect(island.shadowRoot?.textContent).toContain('Ok no problem');
      expect(island.shadowRoot?.querySelector('a')?.getAttribute('href')).toBe('mailto:max@example.com');
      expect(island.shadowRoot?.querySelector('td')?.textContent).toBe('Layout');
      saved = serializeEditorContent(editor);
      expect(saved).toContain('data-quote-border="false"');
      expect(saved).not.toContain('blockquote');
    } finally { editor.destroy(); }
    const reopened = createEditor(saved);
    try {
      expect(reopened.view.dom.querySelector<HTMLElement>('.quoted-html-island')?.style.borderLeftWidth).toBe('');
      expect(serializeEditorContent(reopened)).toBe(saved);
    } finally { reopened.destroy(); }
  });
});
