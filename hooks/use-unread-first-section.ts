import { useEmailStore } from '@/stores/email-store';
import { useSettingsStore } from '@/stores/settings-store';
import { isFilterEmpty } from '@/lib/jmap/search-utils';
import { isUnreadFirstView, type UnreadSection } from '@/lib/unread-first';

/**
 * The Unread section of Mountain View's "Unread first" inbox, when the list
 * on screen is that inbox and its section is loaded; null otherwise.
 */
export function useUnreadFirstSection(): UnreadSection | null {
  const interfaceLayout = useSettingsStore((state) => state.interfaceLayout);
  const mvInboxType = useSettingsStore((state) => state.mvInboxType);
  return useEmailStore((state) => {
    const section = state.unreadSection;
    if (!section || section.mailboxId !== state.selectedMailbox || state.isScheduledView) return null;
    const active = isUnreadFirstView({
      interfaceLayout,
      mvInboxType,
      mailboxRole: state.mailboxes.find((mailbox) => mailbox.id === state.selectedMailbox)?.role,
      otherView: !!state.selectedKeyword || !!state.searchQuery || !isFilterEmpty(state.searchFilters) || state.isUnifiedView,
    });
    return active ? section : null;
  });
}
