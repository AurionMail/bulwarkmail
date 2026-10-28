'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import { refreshAccountTemplates, scheduleAccountSync } from '@/lib/templates/personal-templates';
import { useTemplateStore } from '@/stores/template-store';
import { onSettingsLoadSettled } from '@/stores/settings-store';
import { refreshTeamTemplates } from '@/lib/templates/team-templates';

/**
 * Syncs the active account's templates with the account and reads its
 * team templates (Stalwart 1.0 metadata) when it signs in or becomes
 * active, and again when the tab comes back into view. Renders nothing;
 * does nothing on servers without metadata.
 */
export function AccountTemplateSync() {
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const client = useAuthStore((s) => s.client);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    useAccountTemplatesStore.setState({ active: isAuthenticated ? activeAccountId : null });
  }, [activeAccountId, isAuthenticated]);

  // The browser's list changing (the account's synced settings just
  // loaded, or a template changed there) is merged in at once.
  useEffect(() => {
    if (!isAuthenticated || !activeAccountId) return;
    const unsubscribe = useTemplateStore.subscribe(() => scheduleAccountSync(activeAccountId));
    // Once the account's synced settings have loaded, its browser list is
    // known, even when the load changed nothing in it.
    const unlisten = onSettingsLoadSettled((accountId) => {
      if (accountId === activeAccountId) scheduleAccountSync(activeAccountId);
    });
    return () => {
      unsubscribe();
      unlisten();
    };
  }, [activeAccountId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeAccountId || !client) return;
    refreshAccountTemplates(activeAccountId, 0);
    refreshTeamTemplates(activeAccountId, 0);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refreshAccountTemplates(activeAccountId, 60_000);
      refreshTeamTemplates(activeAccountId, 60_000);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [activeAccountId, client, isAuthenticated]);

  return null;
}
