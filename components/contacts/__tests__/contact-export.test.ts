import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportContact, exportContacts } from '../contact-export';
import { useAuthStore } from '@/stores/auth-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
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
    useAuthStore.setState({ client: { fetchBlob } as never });
  });

  afterEach(() => {
    useAuthStore.setState({ client: null });
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('downloads Stalwart 1.0 blob photos and writes them inline', async () => {
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
    await done;

    const vcf = await exported!.text();
    expect(vcf).toContain('FN:Contact 1');
    expect(vcf).not.toContain('PHOTO');
  });
});
