import { describe, it, expect, afterEach } from 'vitest';
import { getContactPhotoClient } from '../use-contact-photo';
import { useAuthStore } from '@/stores/auth-store';

describe('getContactPhotoClient', () => {
  const active = { name: 'active' } as never;
  const other = { name: 'other' } as never;
  const original = useAuthStore.getState().getClientForAccount;

  afterEach(() => {
    useAuthStore.setState({ client: null, getClientForAccount: original });
  });

  it('uses the active client for a card without a login (single account)', () => {
    useAuthStore.setState({ client: active });
    expect(getContactPhotoClient(undefined)).toBe(active);
  });

  it("uses the client of the card's login in multi-account mode", () => {
    useAuthStore.setState({
      client: active,
      getClientForAccount: (id: string) => (id === 'other@host' ? other : undefined),
    });
    expect(getContactPhotoClient('other@host')).toBe(other);
  });

  it("is null, not the active client, when the card's login has no client", () => {
    // The active client may talk to another server: the download would fail
    // there and the photo stay blank as a remembered failure.
    useAuthStore.setState({ client: active, getClientForAccount: () => undefined });
    expect(getContactPhotoClient('gone@host')).toBeNull();
  });
});
