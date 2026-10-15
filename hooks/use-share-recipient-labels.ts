import { useEffect, useState } from 'react';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Principal } from '@/lib/jmap/types';
import { cachedPrincipals } from '@/lib/jmap/principal-cache';

/** How a share recipient is named: its address, then its description. */
export function principalLabel(principal: Principal): string {
  const address = principal.email || principal.name || principal.id;
  return principal.description && principal.description !== address
    ? `${address} (${principal.description})`
    : address;
}

/**
 * The names of the principals in `shareWith`, or null while any of them is
 * unknown (principals not loaded yet, or not listed by the server).
 */
export function shareRecipientNames(
  shareWith: Record<string, unknown> | null | undefined,
  labels: ReadonlyMap<string, string>,
): string[] | null {
  const names = Object.keys(shareWith ?? {}).map((id) => labels.get(id));
  return names.every((name): name is string => !!name) ? names : null;
}

/**
 * Labels of the server's principals by id, so a shared collection can say
 * whom it is shared with. Nothing is fetched until `enabled`, i.e. until
 * something on screen is shared.
 */
export function useShareRecipientLabels(client: IJMAPClient | null | undefined, enabled: boolean): ReadonlyMap<string, string> {
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    if (!client || !enabled) return;
    let cancelled = false;
    void cachedPrincipals(client).then((principals) => {
      if (!cancelled) setLabels(new Map(principals.map((p) => [p.id, principalLabel(p)])));
    });
    return () => { cancelled = true; };
  }, [client, enabled]);

  return labels;
}
