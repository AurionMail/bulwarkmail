"use client";

import { useTranslations } from "next-intl";
import { Mail, UserPlus, BookUser } from "@/components/icons";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { DirectoryEntry } from "@/stores/contact-store";

interface DirectoryEntryDetailProps {
  entry: DirectoryEntry | null;
  onCompose: (entry: DirectoryEntry) => void;
  onAddToContacts: (entry: DirectoryEntry) => void;
}

/** Read-only view of one directory entry. */
export function DirectoryEntryDetail({ entry, onCompose, onAddToContacts }: DirectoryEntryDetailProps) {
  const t = useTranslations("contacts.directory");

  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-6 text-center">
        <BookUser className="w-8 h-8" />
        <p className="text-sm">{t("select_hint")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col items-center gap-3 px-6 pt-10 pb-6 text-center border-b border-border">
        <Avatar name={entry.name} email={entry.email} size="lg" />
        <div className="min-w-0 max-w-full">
          <h2 className="text-lg font-semibold break-words">{entry.name}</h2>
          {entry.type && (
            <p className="text-xs text-muted-foreground mt-0.5">{t(`type.${entry.type}`)}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => onCompose(entry)}>
            <Mail className="w-4 h-4 me-1.5" />
            {t("write_email")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAddToContacts(entry)}>
            <UserPlus className="w-4 h-4 me-1.5" />
            {t("add_to_contacts")}
          </Button>
        </div>
      </div>
      <dl className="px-6 py-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("email")}</dt>
          <dd className="break-all select-text">{entry.email}</dd>
        </div>
      </dl>
      <p className="px-6 pb-6 text-xs text-muted-foreground">{t("read_only_note")}</p>
    </div>
  );
}
