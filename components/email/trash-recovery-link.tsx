"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { RotateCcw } from "@/components/icons";
import { buildSettingsPath } from "@/lib/deep-links";
import { useDeletedItemsRecovery } from "@/hooks/use-deleted-items-recovery";
import type { Mailbox } from "@/lib/jmap/types";

export const RECOVERY_SETTINGS_TAB = "recovery";

/**
 * A line in the Trash folder's header that leads to Settings > Recover
 * deleted items, when the server offers it for this account. Only in the
 * account's own Trash: a shared or group Trash has an archive of its own
 * that this page doesn't show.
 */
export function TrashRecoveryLink({ mailbox }: { mailbox: Mailbox | undefined }) {
  const t = useTranslations("recover_deleted");
  const router = useRouter();
  const { available, client } = useDeletedItemsRecovery();
  if (!available || !client || mailbox?.role !== "trash" || mailbox.isShared) return null;
  if (mailbox.accountId && mailbox.accountId !== client.getAccountId()) return null;
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
