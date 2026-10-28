"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { nameSelectionRange } from "@/components/ui/prompt-dialog";
import { getFileIconByName } from "@/components/files/file-icons";
import { fileExtension } from "@/hooks/use-wopi-status";
import { cn } from "@/lib/utils";

const DEFAULT_BASE_NAME = "new-file";

/** The kind of document a format makes, for its label; null for an unknown one. */
export function formatKind(ext: string): "text" | "document" | "spreadsheet" | "presentation" | "pdf" | null {
  if (ext === "txt") return "text";
  if (["docx", "odt", "doc", "rtf"].includes(ext)) return "document";
  if (["xlsx", "ods", "xls"].includes(ext)) return "spreadsheet";
  if (["pptx", "odp", "ppt"].includes(ext)) return "presentation";
  if (ext === "pdf") return "pdf";
  return null;
}

/** `name` with its extension replaced by `ext` (or added, when it has none). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base || DEFAULT_BASE_NAME}.${ext}`;
}

interface NewFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  /**
   * Document formats a WOPI editor can create besides .txt (#1393). Without
   * any, this is the plain "New text file" prompt.
   */
  formats: string[];
  validate?: (value: string) => string | null;
}

/**
 * "New file": a name and, with a document editor, the format to start from.
 * The name decides: picking a format rewrites its extension, and typing an
 * extension selects the format it names.
 */
export function NewFileDialog({ isOpen, onClose, onSubmit, formats, validate }: NewFileDialogProps) {
  const t = useTranslations("files");
  const id = useId();
  const choices = formats.length > 0 ? ["txt", ...formats.filter((ext) => ext !== "txt")] : [];
  const [value, setValue] = useState(`${DEFAULT_BASE_NAME}.txt`);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusBaseName = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const [start, end] = nameSelectionRange(input.value, true);
    input.setSelectionRange(start, end);
  };

  useEffect(() => {
    if (!isOpen) return;
    setValue(`${DEFAULT_BASE_NAME}.txt`);
    const timer = setTimeout(focusBaseName, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const trimmed = value.trim();
  const error = trimmed.length > 0 && validate ? validate(trimmed) : null;
  const canSubmit = trimmed.length > 0 && !error;
  const errorId = `${id}-error`;
  const selected = fileExtension(trimmed);

  const pick = (ext: string) => {
    setValue(withExtension(trimmed, ext));
    setTimeout(focusBaseName, 0);
  };

  const label = (ext: string) => {
    const kind = formatKind(ext);
    return kind ? t(`format_${kind}`) : ext.toUpperCase();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    try {
      onSubmit(trimmed);
    } finally {
      onClose();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={choices.length > 0 ? t("new_file") : t("new_text_file")}
      showClose={false}
      initialFocus={inputRef}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="default" disabled={!canSubmit}>
            {t("create")}
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("file_name")}
        aria-label={t("file_name")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={error ? "mt-4 border-destructive focus-visible:border-destructive" : "mt-4"}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      {choices.length > 0 && (
        <div role="radiogroup" aria-label={t("file_format")} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {choices.map((ext) => (
            <button
              key={ext}
              type="button"
              role="radio"
              aria-checked={selected === ext}
              onClick={() => pick(ext)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected === ext ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {getFileIconByName(`file.${ext}`, "md")}
              <span className="text-xs font-medium leading-tight">{label(ext)}</span>
              <span className="text-[11px] text-muted-foreground">.{ext}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
