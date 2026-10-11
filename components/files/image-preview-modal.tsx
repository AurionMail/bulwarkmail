"use client";

import { useState, useEffect } from "react";
import { X, Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { ZoomableImage } from "@/components/files/zoomable-image";

interface ImagePreviewModalProps {
  name: string;
  onClose: () => void;
  onDownload: (name: string) => Promise<void>;
  getImageUrl: (name: string) => Promise<string>;
}

export function ImagePreviewModal({ name, onClose, onDownload, getImageUrl }: ImagePreviewModalProps) {
  const t = useTranslations("files");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setImageUrl(null);

    getImageUrl(name)
      .then((url) => {
        revoke = url;
        if (cancelled) return;
        setImageUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (revoke?.startsWith("blob:")) URL.revokeObjectURL(revoke);
    };
  }, [name, getImageUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
    >
      {/* Same safe-area handling as FilePreviewModal: full-screen overlay +
          `viewport-fit=cover` puts this bar under the iOS status bar in an
          installed PWA (#936). */}
      <div
        className="flex items-center justify-between gap-3 pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(0.5rem+env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium truncate min-w-0">{name}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/15 hover:text-white"
            onClick={() => void onDownload(name)}
            aria-label={t("download")}
            title={t("download")}
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/15 hover:text-white"
            onClick={onClose}
            aria-label={t("close_preview")}
            title={t("close_preview")}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-white/70 text-sm">{t("preview_error")}</p>
          </div>
        )}
        {imageUrl && !error && (
          <ZoomableImage src={imageUrl} alt={name} onBackgroundClick={onClose} />
        )}
      </div>
    </div>
  );
}
