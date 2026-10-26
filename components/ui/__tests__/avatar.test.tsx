import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Avatar } from '../avatar';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { useFaviconRefreshStore } from '@/stores/favicon-refresh-store';
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
      vi.useRealTimers();
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

    it('shows initials when the download fails, after trying once more', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));
      const { container } = render(<Avatar name="Ann Lee" contactPhoto={{ blobId: 'dbcGone' }} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetchBlob).toHaveBeenCalledTimes(1);
      // The cache asks again after a second, since the server refuses a
      // download over its concurrency limit outright; then it gives up.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchBlob).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

      expect(fetchBlob).toHaveBeenCalledTimes(2);
      expect(img(container)).toBeNull();
      expect(container.textContent).toBe('AL');
    });

    it.each([
      [4, 2],
      [8, 4],
    ])('downloads photos %i / 2 = %i at a time for a server with that maxConcurrentRequests', async (limit, atOnce) => {
      const pending: Array<() => void> = [];
      fetchBlob.mockImplementation(() => new Promise<Blob>((resolve) => pending.push(() => resolve(jpeg()))));
      useAuthStore.setState({ client: { fetchBlob, getMaxConcurrentRequests: () => limit } as never });

      render(<>{[0, 1, 2, 3, 4, 5].map((i) => <Avatar key={i} name="Ann" contactPhoto={{ blobId: `dbc${i}` }} />)}</>);
      await act(async () => {});

      expect(fetchBlob).toHaveBeenCalledTimes(atOnce);
      clearContactPhotoCache();
      pending.forEach((resolve) => resolve());
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

    it("asks no other server when the card's login has no client, and tries again once it has one", async () => {
      const original = useAuthStore.getState().getClientForAccount;
      const otherFetch = vi.fn(async () => jpeg());
      let connected = false;
      useAuthStore.setState({
        getClientForAccount: (id: string) => (connected && id === 'other@host' ? { fetchBlob: otherFetch } as never : undefined),
      });
      try {
        const { container } = render(
          <Avatar name="Ann Lee" contactPhoto={{ blobId: 'dbcAnn', mediaType: 'image/jpeg', localAccountId: 'other@host' }} />,
        );
        await act(async () => {});
        // The active client belongs to another login, maybe another server.
        expect(fetchBlob).not.toHaveBeenCalled();
        expect(container.textContent).toBe('AL');

        // Nothing was remembered as a failure: once connected, the photo comes.
        connected = true;
        act(() => useAuthStore.setState({ client: { fetchBlob } as never }));
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

  // #960: a refresh must reach past the browser's two-week cache of the old
  // icon and retry domains whose favicon failed before.
  it('requests the sender favicon again after a refresh', () => {
    useFaviconRefreshStore.setState({ refreshedAt: 0 });
    const { container } = render(<Avatar name="Jan" email="jan@example.cz" />);
    const img = () => container.querySelector('img');
    expect(img()?.getAttribute('src')).toBe('/api/favicon?domain=example.cz');

    fireEvent.error(img()!);
    expect(img()).toBeNull();

    act(() => useFaviconRefreshStore.getState().refresh());
    const stamp = useFaviconRefreshStore.getState().refreshedAt;
    expect(stamp).toBeGreaterThan(0);
    expect(img()?.getAttribute('src')).toBe(`/api/favicon?domain=example.cz&v=${stamp}`);
  });
});
