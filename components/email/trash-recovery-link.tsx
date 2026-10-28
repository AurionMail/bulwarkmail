"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { RotateCcw } from "@/components/icons";
import { buildSettingsPath } from "@/lib/deep-links";
import { RECOVERY_SETTINGS_TAB } from "@/lib/recovery/archived-items";
import { useDeletedItemsRecovery } from "@/hooks/use-deleted-items-recovery";
import { usePolicyStore } from "@/stores/policy-store";
import { useRecoveryStore } from "@/stores/recovery-store";
import type { Mailbox } from "@/lib/jmap/types";

/**
 * A line in the Trash folder's header that leads to Settings > Recover
 * deleted items: only when the server offers it for this account and its
 * archive holds at least one message inside the admin's days window, so it
 * never leads to an empty page. Only in the account's own Trash: a shared or
 * group Trash has an archive of its own that the page doesn't show.
 */
export function TrashRecoveryLink({ mailbox }: { mailbox: Mailbox | undefined }) {
  const t = useTranslations("recover_deleted");
  const router = useRouter();
  const { available, client, key } = useDeletedItemsRecovery();
  const days = usePolicyStore((s) => s.getOrganisation().recovery.days);
  const recent = useRecoveryStore((s) => (key ? s.recent[key] : undefined));
  const checkRecent = useRecoveryStore((s) => s.checkRecent);
  const ownTrash = !!client && mailbox?.role === "trash" && !mailbox.isShared
    && (!mailbox.accountId || mailbox.accountId === client.getAccountId());

  useEffect(() => {
    if (!available || !ownTrash || !client || !key) return;
    void checkRecent(client, key, days);
  }, [available, ownTrash, client, key, days, checkRecent]);

  if (!available || !ownTrash || !recent?.has || recent.days !== days) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground" data-testid="trash-recovery-link">
      <span className="min-w-0 truncate">{t("trash_hint")}</span>
      <button
        type="button"
        onClick={() => router.push(buildSettingsPath(RECOVERY_SETTINGS_TAB))}
        className="ms-auto inline-flex min-h-11 shrink-0 items-center gap-1 font-medium text-primary hover:underline sm:min-h-0"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t("trash_link")}
      </button>
    </div>
  );
}
