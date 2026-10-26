/**
 * The order the sending identities are offered in; the first one is the
 * default sender.
 *
 * Identity/get returns the server's order, which is not the user's: Stalwart
 * 1.0 lists a group's identity (`team@example.org`) before the member's own.
 * So the identity whose address is the login goes first. Addresses are
 * compared the way the server compares them - regardless of case, and with an
 * internationalized domain in its Unicode or its ASCII (`xn--`) form.
 */
import type { Identity } from '@/lib/jmap/types';
import { toAsciiEmail } from '@/lib/idn';

function comparableAddress(address: string): string {
  return toAsciiEmail(address.trim()).toLowerCase();
}

/** True when `email` is the login's own address; a bare login ("user") matches its local part. */
export function emailMatchesLogin(email: string, username: string): boolean {
  const address = comparableAddress(email);
  const login = comparableAddress(username);
  if (address === login) return true;
  return !login.includes('@') && address.split('@')[0] === login;
}

/**
 * The login's own identities first, the canonical one (which cannot be
 * deleted) ahead of its aliases; everything else keeps the server's order.
 */
export function sortIdentities(identities: Identity[], username: string): Identity[] {
  return [...identities].sort((a, b) => {
    const aMatch = emailMatchesLogin(a.email, username);
    const bMatch = emailMatchesLogin(b.email, username);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    if (aMatch && bMatch) {
      if (!a.mayDelete && b.mayDelete) return -1;
      if (a.mayDelete && !b.mayDelete) return 1;
    }
    return 0;
  });
}
