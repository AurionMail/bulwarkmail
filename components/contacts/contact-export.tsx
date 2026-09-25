"use client";

import { useSyncExternalStore } from "react";
import { generateVCard } from "@/lib/vcard";
import type { ContactCard } from "@/lib/jmap/types";
import { getContactDisplayName } from "@/stores/contact-store";
import { inlineContactMediaForExport } from "@/lib/contact-media";
import { getContactPhotoClient } from "@/hooks/use-contact-photo";

// On Stalwart 1.0 an export first downloads every photo, which takes a while
// for a large address book; a second click meanwhile would start it all over.
let exporting = false;
const busyListeners = new Set<() => void>();

function setExporting(value: boolean): void {
  exporting = value;
  for (const listener of busyListeners) listener();
}

function subscribeExporting(listener: () => void): () => void {
  busyListeners.add(listener);
  return () => {
    busyListeners.delete(listener);
  };
}

/** Whether a vCard export is running; the export buttons show it and wait. */
export function useContactExportBusy(): boolean {
  return useSyncExternalStore(subscribeExporting, () => exporting, () => false);
}

/**
 * Builds the .vcf and hands it to the browser. Resolves false, doing nothing,
 * while another export is still running.
 */
async function runExport(contacts: ContactCard[], filename: string): Promise<boolean> {
  if (exporting) return false;
  setExporting(true);
  try {
    // Blob media (Stalwart 1.0) become data: URIs, which a vCard carries inline.
    const cards = await inlineContactMediaForExport(contacts, getContactPhotoClient);
    downloadVcf(generateVCard(cards), filename);
    return true;
  } finally {
    setExporting(false);
  }
}

export function exportContact(contact: ContactCard): Promise<boolean> {
  const name = getContactDisplayName(contact) || "contact";
  return runExport([contact], `${sanitizeFilename(name)}.vcf`);
}

export function exportContacts(contacts: ContactCard[]): Promise<boolean> {
  return runExport(contacts, `contacts-${new Date().toISOString().slice(0, 10)}.vcf`);
}

function downloadVcf(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
}
