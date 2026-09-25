import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Avatar } from '../avatar';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
import type { ContactCard } from '@/lib/jmap/types';

describe('Avatar', () => {
  it('renders initials from full name', () => {
    const { container } = render(<Avatar name="Alice Smith" />);
    expect(container.textContent).toBe('AS');
  });

  it('renders two letters from single-word name', () => {
    const { container } = render(<Avatar name="Alice" />);
    expect(container.textContent).toBe('AL');
  });

  it('renders single letter from email when no name', () => {
    const { container } = render(<Avatar email="bob@example.com" />);
    expect(container.textContent).toBe('B');
  });

  it('renders "?" when no name or email', () => {
    const { container } = render(<Avatar />);
    expect(container.textContent).toBe('?');
  });

  it('produces consistent background color for same input', () => {
    const { container: a } = render(<Avatar name="Alice" />);
    const { container: b } = render(<Avatar name="Alice" />);
    const colorA = (a.firstChild as HTMLElement).style.backgroundColor;
    const colorB = (b.firstChild as HTMLElement).style.backgroundColor;
    expect(colorA).toBe(colorB);
  });

  describe('contact photos', () => {
    const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    const fetchBlob = vi.fn(async () => jpeg());
    // Stalwart 1.0 returns the photo as a blob (contact/get.rs, EmbeddedBlobIds).
    const ann: ContactCard = {
      id: 'c1',
      addressBookIds: {},
      accountId: 'a',
      emails: { e0: { address: 'ann@example.com' } },
      media: { photo: { kind: 'photo', blobId: 'dbcAnn', mediaType: 'image/jpeg' } },
    };
    const img = (container: HTMLElement) => container.querySelector('img');

    beforeEach(() => {
      clearContactPhotoCache();
      fetchBlob.mockReset();
      fetchBlob.mockImplementation(async () => jpeg());
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:photo');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      useAuthStore.setState({ client: { fetchBlob } as never });
    });

    afterEach(() => {
      useAuthStore.setState({ client: null });
      useContactStore.setState({ contacts: [] });
      clearContactPhotoCache();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('downloads a Stalwart 1.0 blob photo from the card\'s account', async () => {
      const { container } = render(
        <Avatar name="Ann" contactPhoto={{ blobId: 'dbcAnn', mediaType: 'image/jpeg', accountId: 'shared-1' }} />,
      );

      await waitFor(() => expect(img(container)?.getAttribute('src')).toBe('blob:photo'));
      expect(fetchBlob).toHaveBeenCalledWith('dbcAnn', 'photo', 'image/jpeg', 'shared-1');
    });

    it('shows a Stalwart 0.16 data: photo without downloading anything', () => {
      const { container } = render(<Avatar name="Ann" contactPhoto={{ uri: 'data:image/jpeg;base64,/9j/' }} />);
      expect(img(container)?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/');
      expect(fetchBlob).not.toHaveBeenCalled();
    });

    it('looks a sender up among the contacts and downloads one copy for every avatar', async () => {
      useContactStore.setState({ contacts: [ann] });
      const { container } = render(
        <>
          <Avatar name="Ann" email="Ann@Example.com" />
          <Avatar name="Ann" email="ann@example.com" />
        </>,
      );

      await waitFor(() => expect(container.querySelectorAll('img[src="blob:photo"]')).toHaveLength(2));
      expect(fetchBlob).toHaveBeenCalledTimes(1);
    });

    it('borrows no other card\'s photo when the contact has none', () => {
      useContactStore.setState({ contacts: [ann] });
      const { container } = render(<Avatar name="Other Ann" email="ann@example.com" contactPhoto={null} />);
      expect(img(container)).toBeNull();
      expect(fetchBlob).not.toHaveBeenCalled();
    });

    it('waits until the avatar is on screen', async () => {
      let report: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | undefined;
      vi.stubGlobal('IntersectionObserver', class {
        constructor(callback: typeof report) { report = callback; }
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      const { container } = render(<Avatar name="Ann" contactPhoto={{ blobId: 'dbcAnn', mediaType: 'image/jpeg' }} />);
      expect(fetchBlob).not.toHaveBeenCalled();

      act(() => report?.([{ target: container.firstChild as Element, isIntersecting: true }]));

      await waitFor(() => expect(img(container)?.getAttribute('src')).toBe('blob:photo'));
      expect(fetchBlob).toHaveBeenCalledTimes(1);
    });

    it('shows initials when the download fails', async () => {
      fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));
      const { container } = render(<Avatar name="Ann Lee" contactPhoto={{ blobId: 'dbcGone' }} />);

      await waitFor(() => expect(fetchBlob).toHaveBeenCalled());
      expect(img(container)).toBeNull();
      expect(container.textContent).toBe('AL');
    });

    it('falls back to initials when a downloaded photo does not render', async () => {
      const { container } = render(<Avatar name="Ann Lee" contactPhoto={{ blobId: 'dbcSvg', mediaType: 'image/svg+xml' }} />);
      await waitFor(() => expect(img(container)).not.toBeNull());

      fireEvent.error(img(container)!);

      expect(img(container)).toBeNull();
      expect(container.textContent).toBe('AL');
    });

    it('downloads through the client of the card\'s login in multi-account mode', async () => {
      const otherFetch = vi.fn(async () => jpeg());
      const original = useAuthStore.getState().getClientForAccount;
      useAuthStore.setState({
        getClientForAccount: (id: string) => (id === 'other@host' ? { fetchBlob: otherFetch } as never : undefined),
      });
      try {
        const { container } = render(
          <Avatar name="Ann" contactPhoto={{ blobId: 'dbcAnn', mediaType: 'image/jpeg', localAccountId: 'other@host' }} />,
        );
        await waitFor(() => expect(img(container)?.getAttribute('src')).toBe('blob:photo'));
        expect(otherFetch).toHaveBeenCalledTimes(1);
        expect(fetchBlob).not.toHaveBeenCalled();
      } finally {
        useAuthStore.setState({ getClientForAccount: original });
      }
    });

    it('downloads nothing when images are disabled', () => {
      render(<Avatar name="Ann" contactPhoto={{ blobId: 'dbcAnn' }} disableImages />);
      expect(fetchBlob).not.toHaveBeenCalled();
    });
  });
});
