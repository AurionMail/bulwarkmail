'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import { refreshAccountTemplates } from '@/lib/templates/personal-templates';

/**
 * Syncs the active account's templates with the account (Stalwart 1.0
 * metadata) when it signs in or becomes active, and again when the tab
 * comes back into view. Renders nothing; does nothing on servers without
 * metadata.
 */
export function AccountTemplateSync() {
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const client = useAuthStore((s) => s.client);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    useAccountTemplatesStore.setState({ active: isAuthenticated ? activeAccountId : null });
  }, [activeAccountId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeAccountId || !client) return;
    refreshAccountTemplates(activeAccountId, 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAccountTemplates(activeAccountId, 60_000);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [activeAccountId, client, isAuthenticated]);

  return null;
}
