"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Folder, FolderInput, Home } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { PaneSpinner } from "@/components/ui/spinner";
import { toast } from "@/stores/toast-store";
import { fileNodeKind } from "@/lib/jmap/filenode-kind";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { FileNode } from "@/lib/jmap/types";

/** What Save to Files needs of an attachment: its blob, name, type and size. */
export interface SaveableAttachment {
  name?: string | null;
  type?: string | null;
  size: number;
  blobId?: string | null;
}

const isFolder = (node: FileNode) => fileNodeKind(node) === "directory";

interface SaveToFilesDialogProps {
  /** The attachment to save; the dialog is open while it is set. */
  attachment: SaveableAttachment | null;
  /** The mail login's client: the attachment's blob is in its own account, as are its files. */
  client: IJMAPClient;
  onClose: () => void;
}

/**
 * "Save to Files" for an attachment: pick a folder of the Files app. The
 * attachment's blob is already on the server, in the same account as the
 * files, so it is filed by blobId with no download or upload.
 */
export function SaveToFilesDialog({ attachment, client, onClose }: SaveToFilesDialogProps) {
  const t = useTranslations("email_viewer.save_to_files");
  const tCommon = useTranslations("common");
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const isOpen = !!attachment;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setNodes(null);
    setFailed(false);
    setTrail([]);
    client.listAllFileNodes().then(
      (list) => { if (!cancelled) setNodes(list); },
      (error) => {
        console.error("Failed to list folders for Save to Files:", error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => { cancelled = true; };
  }, [isOpen, client]);

  const parentId = trail.length > 0 ? trail[trail.length - 1].id : null;
  const folders = useMemo(
    () => (nodes ?? [])
      .filter((n) => isFolder(n) && (n.parentId ?? null) === parentId && !n.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [nodes, parentId],
  );
  const here = trail.length > 0 ? trail[trail.length - 1].name : t("root");

  const save = async () => {
    if (!attachment?.blobId) return;
    setSaving(true);
    try {
      await client.createFileNode(
        attachment.name || "attachment",
        attachment.blobId,
        attachment.type || "application/octet-stream",
        attachment.size,
        parentId,
      );
      toast.success(t("saved"), t("saved_to", { folder: here }));
      onClose();
    } catch (error) {
      console.error("Failed to save the attachment to Files:", error);
      toast.error(t("failed"), error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      description={attachment?.name}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{tCommon("cancel")}</Button>
          <Button onClick={() => void save()} disabled={saving || !nodes}>
            <FolderInput className="w-4 h-4" />
            {t("save_here")}
          </Button>
        </>
      }
    >
      <nav aria-label={t("location")} className="mt-3 flex items-center gap-1 text-sm min-w-0 flex-wrap">
        <IconButton label={t("root")} onClick={() => setTrail([])}>
          <Home />
        </IconButton>
        {trail.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <button
              type="button"
              className="truncate rounded px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setTrail(trail.slice(0, i + 1))}
              title={crumb.name}
              dir="auto"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="mt-2 border border-border rounded-md min-h-40 max-h-72 overflow-y-auto">
        {failed ? (
          <p role="alert" className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("load_failed")}</p>
        ) : !nodes ? (
          <PaneSpinner className="min-h-40" />
        ) : folders.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("no_folders")}</p>
        ) : (
          <ul>
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 max-md:min-h-11 text-sm text-start hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => setTrail([...trail, { id: folder.id, name: folder.name }])}
                >
                  <Folder className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="truncate flex-1" dir="auto" title={folder.name}>{folder.name}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
