import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Principal } from '@/lib/jmap/types';

const principalCache = new WeakMap<IJMAPClient, Promise<Principal[]>>();

/**
 * The principals the server lists, fetched once per client: they rarely change
 * during a session, and the directory can take several requests to page
 * through. An empty answer (failed fetch, client not signed in yet) is not
 * kept, so the next caller asks again.
 */
export function cachedPrincipals(client: IJMAPClient): Promise<Principal[]> {
  let cached = principalCache.get(client);
  if (!cached) {
    cached = Promise.resolve()
      .then(() => client.getPrincipals())
      .catch(() => [] as Principal[])
      .then((principals) => {
        if (principals.length === 0) principalCache.delete(client);
        return principals;
      });
    principalCache.set(client, cached);
  }
  return cached;
}
