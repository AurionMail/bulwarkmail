import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { useAccountPrincipalEmails } from '../use-account-principal-emails';
import { useAccountSecurityStore } from '@/stores/account-security-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// The calendar needs the principal's alias addresses to recognise an
// alias-organised event as the user's own. The JMAP client is restored
// asynchronously after a page load, so the fetch has to wait for it: firing
// on mount failed with "Not authenticated", and the once-only guard then
// never retried for the rest of the session.

let seen: string[] = [];

function Harness({ client }: { client: IJMAPClient | null }) {
  seen = useAccountPrincipalEmails(client);
  return null;
}

const client = {} as IJMAPClient;
let fetchPrincipal: Mock<() => Promise<void>>;

beforeEach(() => {
  seen = [];
  fetchPrincipal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  useAccountSecurityStore.setState({ emails: [], fetchPrincipal });
});

afterEach(cleanup);

describe('useAccountPrincipalEmails', () => {
  it('waits for the JMAP client instead of failing on mount', () => {
    const { rerender } = render(<Harness client={null} />);
    expect(fetchPrincipal).not.toHaveBeenCalled();

    rerender(<Harness client={client} />);
    expect(fetchPrincipal).toHaveBeenCalledTimes(1);
  });

  it('fetches once per mount, not on every render or store update', () => {
    const { rerender } = render(<Harness client={client} />);
    rerender(<Harness client={client} />);
    act(() => {
      useAccountSecurityStore.setState({ emails: ['me@example.com', 'alias@example.com'] });
    });
    expect(fetchPrincipal).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['me@example.com', 'alias@example.com']);
  });

  it('skips the fetch when the principal is already loaded elsewhere', () => {
    useAccountSecurityStore.setState({ emails: ['me@example.com'] });
    render(<Harness client={client} />);
    expect(fetchPrincipal).not.toHaveBeenCalled();
    expect(seen).toEqual(['me@example.com']);
  });
});
