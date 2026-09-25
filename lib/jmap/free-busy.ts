/**
 * Whether the server answers free/busy (Principal/getAvailability) for this
 * user, asked once per client.
 *
 * Stalwart 1.0 refuses every availability lookup while the administrator has
 * directory queries off, which is its default, and says so up front on the
 * user's own principal (`mayGetAvailability: false`). Knowing that before the
 * first lookup keeps the event form from listing every attendee as unknown.
 */

import type { IJMAPClient } from "./client-interface";

const access = new WeakMap<IJMAPClient, boolean>();
const pendingChecks = new WeakMap<IJMAPClient, Promise<boolean>>();

/** What an earlier check learned, or undefined when nothing has been asked yet. */
export function knownAvailabilityAccess(client: IJMAPClient): boolean | undefined {
  return access.get(client);
}

/** Asks the server once per client whether free/busy lookups are allowed. Never rejects. */
export function checkAvailabilityAccess(client: IJMAPClient): Promise<boolean> {
  const known = access.get(client);
  if (known !== undefined) return Promise.resolve(known);
  let check = pendingChecks.get(client);
  if (!check) {
    check = (client.mayGetAvailability ? client.mayGetAvailability() : Promise.resolve(true))
      .then((allowed) => {
        access.set(client, allowed);
        return allowed;
      })
      // A failed check proves nothing either way: look up this time and ask
      // again next time.
      .catch(() => true)
      .finally(() => pendingChecks.delete(client));
    pendingChecks.set(client, check);
  }
  return check;
}

/** The server refused a lookup outright; stop asking for this client. */
export function revokeAvailabilityAccess(client: IJMAPClient): void {
  access.set(client, false);
}
