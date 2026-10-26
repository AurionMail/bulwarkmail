import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { exportContact, exportContacts, useContactExportBusy } from '../contact-export';
import { useAuthStore } from '@/stores/auth-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
import type { BlobBatch } from '@/lib/jmap/client-interface';
import type { ContactCard } from '@/lib/jmap/types';

const card = (id: string, media: ContactCard['media']): ContactCard => ({
  id,
  addressBookIds: {},
  accountId: 'a',
  name: { full: `Contact ${id}` },
  media,
});

describe('vCard export of contact photos', () => {
  const fetchBlob = vi.fn();
  const getContactsAccountId = () => 'a';
  let exported: Blob | undefined;

  beforeEach(() => {
    clearContactPhotoCache();
    fetchBlob.mockReset();
    exported = undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exported = blob as Blob;
      return 'blob:vcf';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useAuthStore.setState({ client: { fetchBlob, getContactsAccountId } as never });
  });

  afterEach(() => {
    useAuthStore.setState({ client: null });
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the Stalwart 1.0 photos of all cards in one Blob/get batch and writes them inline', async () => {
    const getBlobsAsBase64 = vi.fn(async (): Promise<BlobBatch> => ({
      data: new Map([['dbcX', '/9j/'], ['dbcLogo', 'iVBO']]),
      failed: [],
    }));
    useAuthStore.setState({ client: { fetchBlob, getContactsAccountId, getBlobsAsBase64 } as never });

    expect(await exportContacts([
      card('1', { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } }),
      card('2', { logo: { kind: 'logo', blobId: 'dbcLogo', mediaType: 'image/png' } }),
    ])).toBe(true);

    const vcf = await exported!.text();
    expect(getBlobsAsBase64).toHaveBeenCalledWith(['dbcX', 'dbcLogo'], 'a');
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(vcf).toContain('PHOTO;ENCODING=b;TYPE=image/jpeg:/9j/');
    expect(vcf).toContain('LOGO;ENCODING=b;TYPE=image/png:iVBO');
  });

  it('downloads Stalwart 1.0 blob photos one by one when the client cannot batch them', async () => {
    fetchBlob.mockImplementation(async (_blobId: string, _name?: string, type?: string) =>
      new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type }));

    await exportContacts([
      card('1', { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } }),
      card('2', { logo: { kind: 'logo', blobId: 'dbcLogo', mediaType: 'image/png' } }),
    ]);

    const vcf = await exported!.text();
    expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'a');
    expect(fetchBlob).toHaveBeenCalledWith('dbcLogo', 'logo', 'image/png', 'a');
    expect(vcf).toContain('PHOTO;ENCODING=b;TYPE=image/jpeg:/9j/');
    expect(vcf).toContain('LOGO;ENCODING=b;TYPE=image/png:/9j/');
  });

  it('writes Stalwart 0.16 photos without a media type too', async () => {
    await exportContacts([
      card('1', { m0: { kind: 'photo', uri: 'data:;base64,/9j/', mediaType: 'image/jpeg' } }),
      card('2', { m0: { kind: 'photo', uri: 'data:base64,/9j/' } }),
    ]);

    const vcf = await exported!.text();
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(vcf).toContain('PHOTO;ENCODING=b;TYPE=image/jpeg:/9j/');
    expect(vcf).toContain('PHOTO;ENCODING=b:/9j/');
  });

  it('leaves out a photo that cannot be downloaded and exports the rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));

    const done = exportContact(card('1', { photo: { kind: 'photo', blobId: 'dbcGone', mediaType: 'image/jpeg' } }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toBe(true);

    const vcf = await exported!.text();
    expect(vcf).toContain('FN:Contact 1');
    expect(vcf).not.toContain('PHOTO');
  });

  it('says it is busy and ignores another export until the first is done', async () => {
    let deliver!: (batch: BlobBatch) => void;
    const getBlobsAsBase64 = vi.fn(() => new Promise<BlobBatch>((resolve) => { deliver = resolve; }));
    useAuthStore.setState({ client: { fetchBlob, getContactsAccountId, getBlobsAsBase64 } as never });
    const { result } = renderHook(() => useContactExportBusy());
    expect(result.current).toBe(false);

    let first!: Promise<boolean>;
    act(() => { first = exportContacts([card('1', { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } })]); });
    expect(result.current).toBe(true);

    // A second click, from any export button, while the photos download.
    expect(await exportContact(card('2', undefined))).toBe(false);
    expect(await exportContacts([card('3', undefined)])).toBe(false);

    await act(async () => {
      deliver({ data: new Map([['dbcX', '/9j/']]), failed: [] });
      expect(await first).toBe(true);
    });
    expect(result.current).toBe(false);
    expect(getBlobsAsBase64).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(await exported!.text()).toContain('FN:Contact 1');
  });
});
