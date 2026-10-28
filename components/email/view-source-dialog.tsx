"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PaneSpinner } from "@/components/ui/spinner";
import { toast } from "@/stores/toast-store";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { formatFileSize } from "@/lib/utils";

/** More than this is cut in the dialog; the whole message is one Download away. */
export const SOURCE_DISPLAY_LIMIT = 2 * 1024 * 1024;

interface ViewSourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The message's blob, the raw RFC 5322 message as the server stores it. */
  blobId: string | undefined;
  client: IJMAPClient | null | undefined;
  accountId?: string;
  /** Saves the .eml, as "Export as .eml" does. */
  onDownload?: () => void;
}

type SourceState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error" };

/**
 * "View source": the message exactly as the server holds it (Gmail's "Show
 * original"), in the app's dialog shell (R4).
 */
export function ViewSourceDialog({ isOpen, onClose, blobId, client, accountId, onDownload }: ViewSourceDialogProps) {
  const t = useTranslations("email_viewer");
  const tNotifications = useTranslations("notifications");
  const [source, setSource] = useState<SourceState>({ status: "loading" });

  useEffect(() => {
    if (!isOpen) return;
    if (!blobId || !client) {
      setSource({ status: "error" });
      return;
    }
    let cancelled = false;
    setSource({ status: "loading" });
    client.fetchBlob(blobId, "message.eml", "message/rfc822", accountId)
      .then((blob) => blob.text())
      .then((text) => { if (!cancelled) setSource({ status: "ready", text }); })
      .catch((error) => {
        console.error("Failed to load the message source:", error);
        if (!cancelled) setSource({ status: "error" });
      });
    return () => { cancelled = true; };
  }, [isOpen, blobId, client, accountId]);

  const text = source.status === "ready" ? source.text : "";
  const truncated = text.length > SOURCE_DISPLAY_LIMIT;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tNotifications("source_copied"));
    } catch (error) {
      console.error("Failed to copy source:", error);
      toast.error(t("source_copy_failed"));
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("email_source")}
      size="full-on-phone"
      className="sm:max-w-4xl"
      bodyClassName="flex flex-col"
      footer={
        <>
          {onDownload && (
            <Button variant="outline" onClick={onDownload} className="me-auto">
              <Download className="w-4 h-4" />
              {t("export_email")}
            </Button>
          )}
          <Button onClick={() => void copy()} disabled={source.status !== "ready"}>
            <Copy className="w-4 h-4" />
            {t("copy_source")}
          </Button>
        </>
      }
    >
      {source.status === "loading" ? (
        <PaneSpinner label={t("source_loading")} className="min-h-40" />
      ) : source.status === "error" ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("source_load_failed")}
        </p>
      ) : (
        <>
          {truncated && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("source_truncated", { size: formatFileSize(SOURCE_DISPLAY_LIMIT) })}
            </p>
          )}
          <pre
            dir="ltr"
            data-testid="email-source"
            className="mt-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words bg-muted/30 border border-border rounded-lg p-4"
          >
            {truncated ? text.slice(0, SOURCE_DISPLAY_LIMIT) : text}
          </pre>
        </>
      )}
    </Dialog>
  );
}
