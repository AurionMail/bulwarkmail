"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/stores/auth-store";
import { useContactStore } from "@/stores/contact-store";
import { toast } from "@/stores/toast-store";

/**
 * Deletes a contact category, the same way from the Contacts sidebar and
 * from Settings. It only takes the label off contacts, so there is no
 * question: the toast has an Undo that puts it back on the same contacts (R3).
 * Resolves true once the category is gone.
 */
export function useDeleteCategory(): (keyword: string) => Promise<boolean> {
  const t = useTranslations("contacts");

  return useCallback(async (keyword: string) => {
    const { client } = useAuthStore.getState();
    const { supportsSync, removeKeyword, addKeyword } = useContactStore.getState();
    const jmapClient = supportsSync && client ? client : null;
    let ids: string[];
    try {
      ids = await removeKeyword(jmapClient, keyword);
    } catch (error) {
      console.error("Failed to delete category:", error);
      toast.error(t("category_delete_failed"));
      return false;
    }
    toast.success(t("category_deleted", { name: keyword }), {
      action: {
        label: t("undo"),
        onClick: () => {
          void addKeyword(jmapClient, keyword, ids).catch(() => toast.error(t("toast.error_update")));
        },
      },
    });
    return true;
  }, [t]);
}
