"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AlertTriangle } from "@/components/icons";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Shown under the message, e.g. exactly what confirming will send. */
  details?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  details,
  confirmText,
  cancelText,
  variant = "default",
}: ConfirmDialogProps) {
  const t = useTranslations("confirm_dialog");

  const resolvedConfirmText = confirmText || t("confirm");
  const resolvedCancelText = cancelText || t("cancel");

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      role="alertdialog"
      title={title}
      description={message}
      showClose={false}
      icon={
        variant === "destructive" ? (
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
        ) : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {resolvedCancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={() => {
              try {
                onConfirm();
              } finally {
                onClose();
              }
            }}
            className={cn(
              variant === "destructive" && "shadow-sm"
            )}
          >
            {resolvedConfirmText}
          </Button>
        </>
      }
    >
      {details}
    </Dialog>
  );
}
