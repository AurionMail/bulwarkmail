import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { recoveryKey, useRecoveryStore } from '@/stores/recovery-store';
import { useConfig } from '@/hooks/use-config';
import { useRestriction } from '@/hooks/use-restriction';
import { IS_LITE } from '@/lib/lite';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

export interface DeletedItemsRecovery {
  /** Offered to this user for the active account (the server has the feature). */
  available: boolean;
  /** The admin hid it, or the instance switched Stalwart features off: nothing is asked. */
  off: boolean;
  /** Policy and config aren't in for this account yet: nothing is asked or shown. */
  pending: boolean;
  client: IJMAPClient | null;
  /** The detection cache key of the active account. */
  key: string | null;
}

/**
 * Whether "Recover deleted items" is offered for the active account.
 *
 * Nothing is asked until the config and the policy are loaded and the
 * policy is resolved for this client's account, so an account switch never
 * runs on the previous account's restrictions. Then: not hidden by the admin
 * (`deletedItemsRecovery`), Stalwart features on (full Bulwark; Lite asks
 * the server itself), and the server answering x:ArchivedItem/query
 * (Enterprise license). Asked once per account and session, and again after
 * a refusal once its retry time comes, also while the page stays open.
 */
export function useDeletedItemsRecovery(): DeletedItemsRecovery {
  const hiddenByAdmin = useRestriction('deletedItemsRecovery').hidden;
  const policyLoaded = usePolicyStore((s) => s.loaded);
  const subjectEmail = usePolicyStore((s) => s.subject?.email ?? null);
  const { stalwartFeaturesEnabled, isLoading: configLoading } = useConfig();
  const client = useAuthStore((s) => s.client);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const clientEmail = client?.getUsername?.()?.trim().toLowerCase() ?? '';
  const pending = !client || configLoading || !policyLoaded || !subjectEmail || subjectEmail !== clientEmail;
  const off = !pending && (hiddenByAdmin || (!IS_LITE && !stalwartFeaturesEnabled));
  const key = client ? recoveryKey(activeAccountId, client) : null;
  const check = useRecoveryStore((s) => (key ? s.checks[key] : undefined));
  const detect = useRecoveryStore((s) => s.detect);

  useEffect(() => {
    if (pending || off || !client || !key) return;
    if (!check) {
      void detect(client, key);
      return;
    }
    if (check.supported || check.retryAt === null || !Number.isFinite(check.retryAt)) return;
    const timer = setTimeout(() => void detect(client, key, { force: true }), Math.max(0, check.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pending, off, client, key, check, detect]);

  return { available: !pending && !off && !!check?.supported, off, pending, client, key };
}
