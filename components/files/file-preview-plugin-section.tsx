"use client";

import { useMemo } from "react";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { usePluginSlotOffers } from "@/hooks/use-plugin-slot-offers";
import type { FileResourceView } from "@/lib/plugin-types";

/**
 * file-preview-section in the full-screen previews: a panel under the
 * preview. Nothing at all when no plugin offers it or the file is unknown.
 */
export function FilePreviewPluginSection({ file }: { file?: FileResourceView | null }) {
  const offered = usePluginSlotOffers("file-preview-section").length > 0;
  const extraProps = useMemo(() => (file ? { file } : null), [file]);
  if (!offered || !extraProps) return null;
  return (
    // The overlay closes on a click; the panel is not part of the backdrop.
    <div
      className="max-h-[40vh] w-full flex-shrink-0 overflow-y-auto border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      onClick={(e) => e.stopPropagation()}
    >
      <PluginSlot name="file-preview-section" className="w-full" extraProps={extraProps} />
    </div>
  );
}
