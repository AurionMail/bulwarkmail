"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

/**
 * The R5 question for an editor in Settings: closing it with unsaved input
 * asks "Discard changes?" with Keep editing / Discard. Render `discardDialog`
 * next to the editor.
 *
 * ```tsx
 * const { confirmDiscard, discardDialog } = useDiscardChanges();
 * const close = async () => { if (await confirmDiscard(dirty)) onClose(); };
 * ```
 */
export function useDiscardChanges() {
  const t = useTranslations("settings");
  const { dialogProps, confirm } = useConfirmDialog();

  const confirmDiscard = useCallback(
    async (dirty: boolean) => {
      if (!dirty) return true;
      return confirm({
        title: t("discard_changes"),
        message: t("unsaved_changes"),
        confirmText: t("discard"),
        cancelText: t("keep_editing"),
        variant: "destructive",
      });
    },
    [confirm, t]
  );

  return { confirmDiscard, discardDialog: <ConfirmDialog {...dialogProps} /> };
}
