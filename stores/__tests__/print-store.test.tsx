import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { listenForPrinting, requestPrint, usePrintStore } from '../print-store';

/** A page with a print copy, as the contacts and calendar pages render it. */
function Page() {
  const printing = usePrintStore((s) => s.printing);
  const target = usePrintStore((s) => s.target);
  return printing ? <div data-print-root="">{target?.kind ?? 'default'}</div> : null;
}

const copy = () => document.querySelector('[data-print-root]')?.textContent ?? null;

describe('print store', () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
    usePrintStore.setState({ printing: false, target: null });
    vi.restoreAllMocks();
  });

  it('puts the page\'s own copy in the DOM before beforeprint returns (Ctrl+P)', () => {
    render(<Page />);
    stop = listenForPrinting();
    let during: string | null = null;
    // The browser lays the page out for printing right after the handlers ran.
    window.addEventListener('beforeprint', () => { during = copy(); }, { once: true });
    window.dispatchEvent(new Event('beforeprint'));
    expect(during).toBe('default');

    window.dispatchEvent(new Event('afterprint'));
    expect(usePrintStore.getState().printing).toBe(false);
  });

  it('renders the asked-for copy before it opens the print dialog (Print button)', async () => {
    render(<Page />);
    stop = listenForPrinting();
    let atDialog: string | null = null;
    vi.spyOn(window, 'print').mockImplementation(() => { atDialog = copy(); });

    await requestPrint({ kind: 'contact-list' });

    expect(window.print).toHaveBeenCalledOnce();
    expect(atDialog).toBe('contact-list');
    // The dialog's own beforeprint does not replace the asked-for copy.
    window.dispatchEvent(new Event('beforeprint'));
    expect(copy()).toBe('contact-list');
  });

  it('stops listening once no page with a copy is mounted', () => {
    render(<Page />);
    listenForPrinting()();
    window.dispatchEvent(new Event('beforeprint'));
    expect(usePrintStore.getState().printing).toBe(false);
  });

  it('puts scroll offsets back after printing, which display: none dropped', async () => {
    render(<Page />);
    stop = listenForPrinting();
    const pane = document.createElement('div');
    document.body.appendChild(pane);
    // jsdom has no layout: give the pane an offset of its own.
    Object.defineProperty(pane, 'scrollTop', { value: 420, writable: true });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });

    window.dispatchEvent(new Event('beforeprint'));
    pane.scrollTop = 0;
    window.dispatchEvent(new Event('afterprint'));

    expect(pane.scrollTop).toBe(420);
    pane.remove();
  });
});
