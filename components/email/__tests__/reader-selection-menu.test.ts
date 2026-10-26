import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiHooks } from '@/lib/plugin-hooks';
import { bodyMenuPoint, selectedTextIn, watchBodySelection, watchElementSelection } from '../reader-selection-menu';

// Selected text inside a message body, for plugins. An HTML body is a
// sandboxed iframe: its selection never reaches the page's selectionchange,
// so the body document itself is watched.

function bodyFrame(html: string) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = html;
  return { iframe, doc };
}

function selectAll(doc: Document, el: Element) {
  const range = doc.createRange();
  range.selectNodeContents(el);
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('watchBodySelection', () => {
  it('reports the selected text a moment after it changes, once per change, and tells the plugins', async () => {
    const { iframe, doc } = bodyFrame('<p>Quoted words</p>');
    const onSelection = vi.fn();
    const heard = vi.fn();
    const handler = uiHooks.onTextSelectionChange.register('p1', heard);
    try {
      watchBodySelection(doc, iframe, { emailId: 'e1', onSelection });

      selectAll(doc, doc.querySelector('p')!);
      doc.dispatchEvent(new Event('selectionchange'));
      doc.dispatchEvent(new Event('selectionchange'));
      expect(onSelection).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(onSelection).toHaveBeenCalledTimes(1);
      expect(onSelection).toHaveBeenCalledWith('Quoted words');
      await Promise.resolve();
      expect(heard).toHaveBeenCalledWith({ text: 'Quoted words', source: 'email-body', emailId: 'e1' });

      // The same selection again is not reported again.
      doc.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(200);
      expect(onSelection).toHaveBeenCalledTimes(1);

      // Gone: reported as empty, but plugins are not told about nothing.
      doc.getSelection()!.removeAllRanges();
      doc.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(200);
      expect(onSelection).toHaveBeenLastCalledWith('');
      await Promise.resolve();
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      handler.dispose();
    }
  });

  it('opens the menu on a right-click on selected text, at the frame offset, and keeps the browser menu otherwise', () => {
    const { iframe, doc } = bodyFrame('<p>Quoted words</p>');
    iframe.getBoundingClientRect = () => ({ left: 100, top: 50, width: 600, height: 400, right: 700, bottom: 450, x: 100, y: 50, toJSON: () => ({}) });
    Object.defineProperty(doc.documentElement, 'clientWidth', { value: 600, configurable: true });
    const onContextMenu = vi.fn().mockReturnValue(true);
    watchBodySelection(doc, iframe, { emailId: 'e1', onContextMenu });

    // No selection: nothing happens.
    const idle = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, cancelable: true, bubbles: true });
    doc.dispatchEvent(idle);
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(idle.defaultPrevented).toBe(false);

    selectAll(doc, doc.querySelector('p')!);
    const click = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, cancelable: true, bubbles: true });
    doc.dispatchEvent(click);
    expect(onContextMenu).toHaveBeenCalledWith({ x: 110, y: 70 }, 'Quoted words');
    expect(click.defaultPrevented).toBe(true);

    // The menu declined (no plugin entries): the browser's own menu stays.
    onContextMenu.mockReturnValue(false);
    const declined = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, cancelable: true, bubbles: true });
    doc.dispatchEvent(declined);
    expect(declined.defaultPrevented).toBe(false);
  });

  it('scales the point when the body was shrunk to fit a narrow screen', () => {
    const { iframe, doc } = bodyFrame('<p>x</p>');
    iframe.getBoundingClientRect = () => ({ left: 0, top: 100, width: 300, height: 400, right: 300, bottom: 500, x: 0, y: 100, toJSON: () => ({}) });
    Object.defineProperty(doc.documentElement, 'clientWidth', { value: 600, configurable: true });
    expect(bodyMenuPoint({ clientX: 200, clientY: 40 }, doc, iframe)).toEqual({ x: 100, y: 120 });
  });

  it('stops when told to', () => {
    const { iframe, doc } = bodyFrame('<p>Quoted words</p>');
    const onSelection = vi.fn();
    const stop = watchBodySelection(doc, iframe, { emailId: 'e1', onSelection });
    stop();
    selectAll(doc, doc.querySelector('p')!);
    doc.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(200);
    expect(onSelection).not.toHaveBeenCalled();
  });
});

describe('a plain-text body in the page', () => {
  it('counts only a selection inside the body', () => {
    document.body.innerHTML = '<div id="other">elsewhere</div><div id="body"><p>Plain words</p></div>';
    const body = document.getElementById('body')!;
    selectAll(document, document.getElementById('other')!);
    expect(selectedTextIn(body)).toBe('');
    selectAll(document, body.querySelector('p')!);
    expect(selectedTextIn(body)).toBe('Plain words');
  });

  it('reports changes of the page selection inside the body', () => {
    document.body.innerHTML = '<div id="body"><p>Plain words</p></div>';
    const body = document.getElementById('body')!;
    const onSelection = vi.fn();
    watchElementSelection(body, { emailId: 'e1', onSelection });
    selectAll(document, body.querySelector('p')!);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(200);
    expect(onSelection).toHaveBeenCalledWith('Plain words');
  });
});
