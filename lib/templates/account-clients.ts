import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { useAuthStore } from '@/stores/auth-store';

/** What the template code asks of a signed-in account's client. */
export type TemplateClient = Pick<IJMAPClient, 'getAccountId'> & Partial<Pick<IJMAPClient,
  'supportsBulwarkMetadata' | 'getBulwarkMetadata' | 'setBulwarkMetadata'
  | 'getSharedAccounts' | 'getAccountInfo' | 'getPrincipalTypes' | 'getMailboxes'>>;

/** The client of the signed-in account `localAccountId`, or null when it isn't connected. */
export function clientFor(localAccountId: string): TemplateClient | null {
  const auth = useAuthStore.getState();
  const client = auth.getClientForAccount?.(localAccountId) ?? (localAccountId === auth.activeAccountId ? auth.client : null);
  if (!client || typeof (client as { getAccountId?: unknown }).getAccountId !== 'function') return null;
  return client as unknown as TemplateClient;
}

/** Whether Bulwark may use the metadata of this account of the client. */
export function hasMetadata(
  client: TemplateClient | null | undefined,
  accountId: string,
): client is TemplateClient & Required<Pick<TemplateClient, 'getBulwarkMetadata' | 'setBulwarkMetadata'>> {
  return !!client
    && typeof client.getBulwarkMetadata === 'function'
    && typeof client.setBulwarkMetadata === 'function'
    && client.supportsBulwarkMetadata?.(accountId) === true;
}
