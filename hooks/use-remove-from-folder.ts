"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/stores/auth-store";
import { useEmailStore, removalFolder } from "@/stores/email-store";
import { runBatchEmailAction } from "@/lib/email-action-toast";
import { localizeMailboxName } from "@/lib/mailbox-label";
import type { Email } from "@/lib/jmap/types";

/**
 * "Remove from this folder" (#615): takes the messages out of the open folder
 * only, keeps them in their other folders, and toasts the outcome.
 */
export function useRemoveFromFolder(): (emails: Email[]) => Promise<void> {
  const t = useTranslations("notifications");
  const tSidebar = useTranslations("sidebar");
  const client = useAuthStore((state) => state.client);
  const removeFromMailbox = useEmailStore((state) => state.removeFromMailbox);

  return useCallback(async (emails: Email[]) => {
    if (!client || emails.length === 0) return;
    const folder = removalFolder(useEmailStore.getState());
    const mailbox = folder
      ? localizeMailboxName(folder.role, folder.name, (key) => tSidebar(`mailboxes.${key}`))
      : "";
    await runBatchEmailAction(() => removeFromMailbox(client, emails), {
      success: t("removed_from_folder", { mailbox }),
      error: t("remove_from_folder_failed"),
    });
  }, [client, removeFromMailbox, t, tSidebar]);
}
