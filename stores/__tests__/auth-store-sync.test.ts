import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../auth-store';
import { useIdentityStore } from '../identity-store';
import type { Identity } from '@/lib/jmap/types';

const makeIdentity = (overrides: Partial<Identity> = {}): Identity => ({
  id: 'id-1',
  name: 'Test User',
  email: 'test@example.com',
  mayDelete: true,
  ...overrides,
});

describe('auth-store syncIdentities', () => {
  beforeEach(() => {
    useIdentityStore.setState({
      identities: [],
      selectedIdentityId: null,
      isLoading: false,
      error: null,
      subAddress: { recentTags: [], tagSuggestions: {} },
    });
    useAuthStore.setState({
      identities: [],
      primaryIdentity: null,
    });
  });

  it('should copy identities from identity store to auth store', () => {
    const identities = [
      makeIdentity({ id: 'id-1', name: 'Alice' }),
      makeIdentity({ id: 'id-2', name: 'Bob', email: 'bob@example.com' }),
    ];
    useIdentityStore.getState().setIdentities(identities);

    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().identities).toHaveLength(2);
    expect(useAuthStore.getState().identities[0].name).toBe('Alice');
    expect(useAuthStore.getState().identities[1].name).toBe('Bob');
  });

  it('should set primaryIdentity to first identity', () => {
    const identities = [
      makeIdentity({ id: 'id-1', name: 'Primary' }),
      makeIdentity({ id: 'id-2', name: 'Secondary' }),
    ];
    useIdentityStore.getState().setIdentities(identities);

    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().primaryIdentity?.id).toBe('id-1');
    expect(useAuthStore.getState().primaryIdentity?.name).toBe('Primary');
  });

  it('should set primaryIdentity to null when no identities', () => {
    // Auth store starts with an identity
    useAuthStore.setState({
      identities: [makeIdentity()],
      primaryIdentity: makeIdentity(),
    });
    useIdentityStore.getState().setIdentities([]);

    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().identities).toEqual([]);
    expect(useAuthStore.getState().primaryIdentity).toBeNull();
  });

  it('should reflect identity store changes after addIdentity', () => {
    useIdentityStore.getState().setIdentities([makeIdentity({ id: 'id-1' })]);
    useAuthStore.getState().syncIdentities();
    expect(useAuthStore.getState().identities).toHaveLength(1);

    useIdentityStore.getState().addIdentity(makeIdentity({ id: 'id-2', email: 'new@example.com' }));
    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().identities).toHaveLength(2);
  });

  it('should reflect identity store changes after removeIdentity', () => {
    useIdentityStore.getState().setIdentities([
      makeIdentity({ id: 'id-1' }),
      makeIdentity({ id: 'id-2' }),
    ]);
    useAuthStore.getState().syncIdentities();
    expect(useAuthStore.getState().identities).toHaveLength(2);

    useIdentityStore.getState().removeIdentity('id-1');
    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().identities).toHaveLength(1);
    expect(useAuthStore.getState().identities[0].id).toBe('id-2');
    expect(useAuthStore.getState().primaryIdentity?.id).toBe('id-2');
  });

  it('should reflect identity store changes after updateIdentityLocal', () => {
    useIdentityStore.getState().setIdentities([
      makeIdentity({ id: 'id-1', name: 'Old Name', textSignature: '' }),
    ]);
    useAuthStore.getState().syncIdentities();

    useIdentityStore.getState().updateIdentityLocal('id-1', {
      name: 'New Name',
      textSignature: 'Regards, Me',
    });
    useAuthStore.getState().syncIdentities();

    expect(useAuthStore.getState().identities[0].name).toBe('New Name');
    expect(useAuthStore.getState().identities[0].textSignature).toBe('Regards, Me');
  });
});

describe('auth-store refreshIdentities', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: [], preferredPrimaryId: null });
  });

  // Seen on a live Stalwart 1.0 server: for a member of team@example.org the
  // group's identity comes first in Identity/get. The login must still send
  // from its own address by default, even when it was typed in another case.
  it("makes the login's own identity primary when Stalwart 1.0 lists the group's first", async () => {
    const fromServer = [
      makeIdentity({ id: 'team', email: 'team@example.org', mayDelete: false }),
      makeIdentity({ id: 'usera', email: 'usera@example.org', mayDelete: false }),
    ];
    useAuthStore.setState({
      client: { getIdentities: async () => fromServer } as never,
      username: 'UserA@Example.org',
    });

    await useAuthStore.getState().refreshIdentities();

    expect(useAuthStore.getState().primaryIdentity?.id).toBe('usera');
    expect(useIdentityStore.getState().identities.map((i) => i.id)).toEqual(['usera', 'team']);
  });
});
