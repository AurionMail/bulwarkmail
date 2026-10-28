import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printContact, printLabels } from '../contact-print';
import { useAuthStore } from '@/stores/auth-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
import type { ContactCard } from '@/lib/jmap/types';

const LABELS = printLabels((key) => key, 'en');

const base: ContactCard = {
  id: 'c1',
  addressBookIds: {},
  accountId: 'a',
  name: { full: 'Ann Lee' },
};

describe('printContact', () => {
  const fetchBlob = vi.fn();
  let printWindow: { closed: boolean; document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }; focus: ReturnType<typeof vi.fn>; print: ReturnType<typeof vi.fn> };
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearContactPhotoCache();
    fetchBlob.mockReset();
    printWindow = { closed: false, document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    open = vi.spyOn(window, 'open').mockReturnValue(printWindow as unknown as Window);
    useAuthStore.setState({ client: { fetchBlob } as never });
  });

  afterEach(() => {
    useAuthStore.setState({ client: null });
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const written = () => printWindow.document.write.mock.calls[0][0] as string;

  it('opens the window right away and prints a Stalwart 1.0 photo inline as a data: URI', async () => {
    fetchBlob.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));

    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } } }, LABELS);
    // Before anything is awaited, while the click still allows a popup.
    expect(open).toHaveBeenCalledTimes(1);
    await done;

    expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'a');
    expect(written()).toContain('<img class="photo" src="data:image/jpeg;base64,/9j/"');
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it('prints a Stalwart 0.16 photo as it is', async () => {
    await printContact({ ...base, media: { photo: { kind: 'photo', uri: 'data:base64,/9j/' } } }, LABELS);

    expect(fetchBlob).not.toHaveBeenCalled();
    expect(written()).toContain('src="data:image/jpeg;base64,/9j/"');
  });

  it('prints the initial instead when the photo cannot be downloaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));

    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcGone' } } }, LABELS);
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(written()).not.toContain('<img');
    expect(written()).toContain('class="photo placeholder">A</div>');
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it('does not write into a window the user already closed', async () => {
    fetchBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcX' } } }, LABELS);
    printWindow.closed = true;
    await done;
    expect(printWindow.document.write).not.toHaveBeenCalled();
  });

  it('prints from a hidden frame in the page when the browser blocks the print window', async () => {
    open.mockReturnValue(null);
    await printContact({ ...base, emails: { e: { address: 'ann@example.com' } } } as ContactCard, LABELS);

    const frame = document.querySelector('iframe[data-contact-print-frame]') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.srcdoc).toContain('<h1>Ann Lee</h1>');
    expect(frame.srcdoc).toContain('<dd>ann@example.com</dd>');
    vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => {});
    const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {});

    // The empty start page some browsers load first is not printed.
    frame.dispatchEvent(new Event('load'));
    expect(print).not.toHaveBeenCalled();

    frame.contentDocument!.body.innerHTML = '<h1>Ann Lee</h1>';
    frame.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalledOnce();

    // Gone once the print dialog closes.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
    vi.runAllTimers();
    expect(document.querySelector('iframe[data-contact-print-frame]')).toBeNull();
  });

  it('prints the headings and dates in the language of the app', async () => {
    const de = printLabels((key) => ({ 'detail.emails': 'E-Mail-Adressen', 'detail.anniversaries': 'Jahrestage', 'detail.anniversary_birth': 'Geburtstag' } as Record<string, string>)[key] ?? key, 'de');
    await printContact({
      ...base,
      emails: { e: { address: 'ann@example.com' } },
      anniversaries: { b: { kind: 'birth', date: { year: 1988, month: 3, day: 15 } } },
    } as ContactCard, de);
    expect(written()).toContain('<h2>E-Mail-Adressen</h2>');
    expect(written()).toContain('<dt>Geburtstag</dt><dd>15. März 1988</dd>');
    expect(written()).not.toContain('>Email<');
  });
});
