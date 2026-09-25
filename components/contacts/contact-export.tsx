"use client";

import { generateVCard } from "@/lib/vcard";
import type { ContactCard } from "@/lib/jmap/types";
import { getContactDisplayName } from "@/stores/contact-store";
import { hasBlobMedia, inlineContactMedia } from "@/lib/contact-media";
import { getContactPhotoClient } from "@/hooks/use-contact-photo";

export async function exportContact(contact: ContactCard): Promise<void> {
  const vcf = generateVCard([await withInlineMedia(contact)]);
  const name = getContactDisplayName(contact) || "contact";
  downloadVcf(vcf, `${sanitizeFilename(name)}.vcf`);
}

export async function exportContacts(contacts: ContactCard[]): Promise<void> {
  const vcf = generateVCard(await Promise.all(contacts.map(withInlineMedia)));
  downloadVcf(vcf, `contacts-${new Date().toISOString().slice(0, 10)}.vcf`);
}

/**
 * The card with its blob media (Stalwart 1.0) downloaded into data: URIs,
 * which a vCard carries inline. A photo that cannot be downloaded is left out
 * rather than failing the export.
 */
async function withInlineMedia(contact: ContactCard): Promise<ContactCard> {
  if (!hasBlobMedia(contact.media)) return contact;
  const media = await inlineContactMedia(contact.media, {
    client: getContactPhotoClient(contact.localAccountId),
    accountId: contact.accountId,
    localAccountId: contact.localAccountId,
  }, "drop");
  return { ...contact, media };
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
