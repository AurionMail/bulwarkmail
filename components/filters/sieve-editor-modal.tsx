"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle, Loader2 } from "@/components/icons";
import { useDiscardChanges } from "@/components/settings/use-discard-changes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { parseScript } from "@/lib/sieve/parser";

/** Rules made in the visual builder (not external or opaque blocks). */
function hasVisualRules(script: string): boolean {
  const parsed = parseScript(script);
  return !parsed.isOpaque && parsed.rules.some((r) => !r.origin || r.origin === "bulwark");
}

interface SieveEditorModalProps {
  content: string;
  onSave: (content: string) => void;
  onClose: () => void;
  onValidate: (content: string) => Promise<{ isValid: boolean; errors?: string[] }>;
}

export function SieveEditorModal({
  content,
  onSave,
  onClose,
  onValidate,
}: SieveEditorModalProps) {
  const t = useTranslations("settings.filters.sieve_editor");
  const tSettings = useTranslations("settings");
  const [script, setScript] = useState(content);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    errors?: string[];
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = script !== content;
  const { confirmDiscard, discardDialog } = useDiscardChanges();
  // Escape, the X, Cancel: an edited script is only dropped when the user
  // says so; a click outside is ignored while it is edited.
  const requestClose = useCallback(async () => {
    if (await confirmDiscard(dirty)) onClose();
  }, [confirmDiscard, dirty, onClose]);

  const lineCount = script.split("\n").length;

  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await onValidate(script);
      setValidationResult(result);
    } catch {
      setValidationResult({ isValid: false, errors: [t("validation_failed")] });
    } finally {
      setIsValidating(false);
    }
  }, [script, onValidate, t]);

  // The visual rules only go away when the saved script no longer carries
  // them in a form the builder reads; only then does Save ask, once.
  const startsWithVisualRules = useMemo(() => hasVisualRules(content), [content]);
  const { dialogProps: overwriteProps, confirm: confirmOverwrite } = useConfirmDialog();
  const handleSave = useCallback(async () => {
    if (startsWithVisualRules && !hasVisualRules(script)) {
      const ok = await confirmOverwrite({
        title: t("overwrite_title"),
        message: t("overwrite_message"),
        confirmText: t("save"),
        cancelText: tSettings("keep_editing"),
        variant: "destructive",
      });
      if (!ok) return;
    }
    onSave(script);
  }, [startsWithVisualRules, script, confirmOverwrite, t, tSettings, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      setScript(script.substring(0, start) + "  " + script.substring(end));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  return (
    <>
    <Dialog
      isOpen
      onClose={() => void requestClose()}
      dirty={dirty}
      title={t("title")}
      size="lg"
      className="max-w-4xl max-h-[90vh]"
      bodyClassName="flex flex-col"
      initialFocus={textareaRef}
      footer={
        <>
          <Button
            variant="outline"
            onClick={handleValidate}
            disabled={isValidating || !script.trim()}
            className="me-auto"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
                {t("validating")}
              </>
            ) : (
              t("validate")
            )}
          </Button>
          <Button variant="outline" onClick={() => void requestClose()}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!script.trim()}>
            {t("save")}
          </Button>
        </>
      }
    >
        <div className="pt-4 flex-1 min-h-0 flex flex-col space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{t("warning")}</p>
          </div>

          <div className="flex-1 min-h-[16rem] h-[50vh] flex border border-border rounded-md overflow-hidden">
            <div
              className="w-10 flex-shrink-0 bg-muted border-e border-border py-2 text-end pe-2 select-none overflow-hidden"
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div
                  key={i}
                  className="text-xs text-muted-foreground leading-[1.5rem]"
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={script}
              onChange={(e) => {
                setScript(e.target.value);
                setValidationResult(null);
              }}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-background text-foreground font-mono text-sm p-2 resize-none focus:outline-none leading-[1.5rem]"
              spellCheck={false}
              aria-label={t("script_content")}
            />
          </div>

          {validationResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                validationResult.isValid
                  ? "bg-success/10 border border-success/20 text-success"
                  : "bg-destructive/10 border border-destructive/20 text-destructive"
              }`}
            >
              {validationResult.isValid ? (
                <>
                  <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>{t("valid")}</p>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t("invalid")}</p>
                    {validationResult.errors?.map((err, i) => (
                      <p key={i} className="mt-1 font-mono text-xs">
                        {err}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

    </Dialog>
    {discardDialog}
    <ConfirmDialog {...overwriteProps} />
    </>
  );
}
