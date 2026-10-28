import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { recoveryKey, useRecoveryStore } from '@/stores/recovery-store';
import { useRestriction } from '@/hooks/use-restriction';
import { useConfig } from '@/hooks/use-config';
import { IS_LITE } from '@/lib/lite';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

export interface DeletedItemsRecovery {
  /** Offered to this user for the active account. */
  available: boolean;
  /** The admin hid it, or the instance switched Stalwart features off: nothing is asked. */
  off: boolean;
  client: IJMAPClient | null;
  /** The detection cache key of the active account. */
  key: string | null;
}

/**
 * Whether "Recover deleted items" is offered for the active account: not
 * hidden by the admin (`deletedItemsRecovery`), Stalwart features on (full
 * Bulwark; Lite asks the server itself), and the server answering
 * x:ArchivedItem/query (Enterprise license). Asks once per account and
 * session, and again after a refusal once its retry time comes, also while
 * the page stays open.
 */
export function useDeletedItemsRecovery(): DeletedItemsRecovery {
  const hidden = useRestriction('deletedItemsRecovery').hidden;
  const { stalwartFeaturesEnabled } = useConfig();
  const client = useAuthStore((s) => s.client);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const off = hidden || (!IS_LITE && !stalwartFeaturesEnabled);
  const key = client ? recoveryKey(activeAccountId, client) : null;
  const check = useRecoveryStore((s) => (key ? s.checks[key] : undefined));
  const detect = useRecoveryStore((s) => s.detect);

  useEffect(() => {
    if (off || !client || !key) return;
    if (!check) {
      void detect(client, key);
      return;
    }
    if (check.supported || check.retryAt === null || !Number.isFinite(check.retryAt)) return;
    const timer = setTimeout(() => void detect(client, key), Math.max(0, check.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [off, client, key, check, detect]);

  return { available: !off && !!check?.supported, off, client, key };
}
