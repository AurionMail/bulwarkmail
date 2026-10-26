"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { useContactStore, type DirectoryEntry } from "@/stores/contact-store";
import { DirectoryBrowser, directoryKey } from "./directory-browser";

export type RecipientField = "to" | "cc" | "bcc";

interface DirectoryPickerDialogProps {
  client: IJMAPClient | null;
  onClose: () => void;
  /** Called with the checked entries in directory order; the dialog closes afterwards. */
  onAdd: (field: RecipientField, entries: DirectoryEntry[]) => void;
}

/** The composer's "Select from directory" dialog. */
export function DirectoryPickerDialog({ client, onClose, onAdd }: DirectoryPickerDialogProps) {
  const t = useTranslations("contacts.directory");
  const modalRef = useFocusTrap({ isActive: true, onEscape: onClose, restoreFocus: true });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const add = (field: RecipientField) => {
    const entries = useContactStore.getState().directoryPrincipals.filter((e) => selected.has(directoryKey(e)));
    if (entries.length === 0) return;
    onAdd(field, entries);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-picker-title"
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg h-[80vh] max-h-[640px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        data-testid="directory-picker-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="directory-picker-title" className="text-sm font-semibold text-foreground">
            {t("picker_title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <DirectoryBrowser
          client={client}
          selected={selected}
          onSelectedChange={setSelected}
          autoFocusSearch
          className="flex-1"
        />

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground me-auto tabular-nums">
            {t("selected_count", { count: selected.size })}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => add("bcc")}>{t("add_bcc")}</Button>
          <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => add("cc")}>{t("add_cc")}</Button>
          <Button size="sm" disabled={selected.size === 0} onClick={() => add("to")}>{t("add_to")}</Button>
        </div>
      </div>
    </div>
  );
}
