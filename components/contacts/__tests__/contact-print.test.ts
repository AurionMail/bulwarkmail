import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printContact } from '../contact-print';
import { useAuthStore } from '@/stores/auth-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
import type { ContactCard } from '@/lib/jmap/types';

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

    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } } });
    // Before anything is awaited, while the click still allows a popup.
    expect(open).toHaveBeenCalledTimes(1);
    await done;

    expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'a');
    expect(written()).toContain('<img class="photo" src="data:image/jpeg;base64,/9j/"');
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it('prints a Stalwart 0.16 photo as it is', async () => {
    await printContact({ ...base, media: { photo: { kind: 'photo', uri: 'data:base64,/9j/' } } });

    expect(fetchBlob).not.toHaveBeenCalled();
    expect(written()).toContain('src="data:image/jpeg;base64,/9j/"');
  });

  it('prints the initial instead when the photo cannot be downloaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));

    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcGone' } } });
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(written()).not.toContain('<img');
    expect(written()).toContain('class="photo placeholder">A</div>');
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it('does not write into a window the user already closed', async () => {
    fetchBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcX' } } });
    printWindow.closed = true;
    await done;
    expect(printWindow.document.write).not.toHaveBeenCalled();
  });
});
