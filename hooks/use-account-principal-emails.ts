import { useEffect, useRef } from 'react';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { useAccountSecurityStore } from '@/stores/account-security-store';

/**
 * The account's principal addresses - its primary address plus the enabled
 * aliases - loaded on first use. Aliases live on the Stalwart principal, not
 * on the identities, so a view that must recognise an alias-organised event
 * as the user's own (the calendar's isOrganizer) needs this list.
 *
 * The fetch waits for the JMAP client. After a page load the client is
 * restored asynchronously; asking for the principal before it exists only
 * fails with "Not authenticated", and a once-only guard that fires on mount
 * then blocks the retry for the rest of the session.
 */
export function useAccountPrincipalEmails(client: IJMAPClient | null): string[] {
  const emails = useAccountSecurityStore((s) => s.emails);
  const fetchPrincipal = useAccountSecurityStore((s) => s.fetchPrincipal);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!client || fetchedRef.current) return;
    fetchedRef.current = true;
    if (emails.length > 0) return; // already loaded elsewhere
    void fetchPrincipal();
  }, [client, emails, fetchPrincipal]);

  return emails;
}
