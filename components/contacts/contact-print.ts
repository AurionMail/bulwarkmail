import type { ContactCard, PartialDate } from "@/lib/jmap/types";
import { getContactDisplayName, getContactPhotoRef } from "@/stores/contact-store";
import { loadContactMediaBlob } from "@/lib/contact-media";
import { blobToDataUri } from "@/lib/data-uri";
import { getContactPhotoClient } from "@/hooks/use-contact-photo";

const PHOTO_TIMEOUT_MS = 5000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The photo as something the print window shows on its own: a blob photo
 * (Stalwart 1.0) is downloaded into a data: URI, and left out when that
 * fails or takes too long.
 */
async function printablePhotoUri(contact: ContactCard): Promise<string | undefined> {
  const photo = getContactPhotoRef(contact);
  if (!photo) return undefined;
  if ("uri" in photo) return photo.uri;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const blob = await Promise.race([
    loadContactMediaBlob({ kind: "photo", blobId: photo.blobId, mediaType: photo.mediaType }, {
      client: getContactPhotoClient(photo.localAccountId),
      accountId: photo.accountId,
      localAccountId: photo.localAccountId,
    }),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PHOTO_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  return blob ? blobToDataUri(blob, photo.mediaType).catch(() => undefined) : undefined;
}

export async function printContact(contact: ContactCard, displayName?: string): Promise<void> {
  // Open the window before anything is awaited: browsers allow the popup only
  // while the click that asked for it is being handled.
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const name = displayName || getContactDisplayName(contact);
  const photoUri = await printablePhotoUri(contact);
  if (printWindow.closed) return;
  const emails = contact.emails ? Object.values(contact.emails) : [];
  const phones = contact.phones ? Object.values(contact.phones) : [];
  const orgs = contact.organizations ? Object.values(contact.organizations) : [];
  const titles = contact.titles ? Object.values(contact.titles) : [];
  const addresses = contact.addresses ? Object.values(contact.addresses) : [];
  const onlineServices = contact.onlineServices ? Object.values(contact.onlineServices) : [];
  const notes = contact.notes ? Object.values(contact.notes) : [];
  const anniversaries = contact.anniversaries ? Object.values(contact.anniversaries) : [];

  const rows: string[] = [];
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    rows.push(`<section><h2>${escapeHtml(title)}</h2><dl>${items.join("")}</dl></section>`);
  };
  const row = (label: string, value: string) =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;

  section("Email", emails.map(e => row(e.label || "Email", e.address || "")));
  section("Phone", phones.map(p => row(p.label || "Phone", p.number || "")));
  section(
    "Organization",
    orgs.map(o => {
      const units = o.units ? Object.values(o.units).map(u => u.name).filter(Boolean).join(", ") : "";
      const value = [o.name, units].filter(Boolean).join(" \u2014 ");
      return row("Organization", value);
    }),
  );
  section("Title", titles.map(t => row(t.kind === "role" ? "Role" : "Title", t.name || "")));
  section(
    "Address",
    addresses.map(a => {
      const parts = [a.street, a.locality, a.region, a.postcode, a.country]
        .map(p => (typeof p === "string" ? p : ""))
        .filter(Boolean);
      return row(a.label || "Address", parts.join(", "));
    }),
  );
  section(
    "Online",
    onlineServices.map(s => row(s.label || s.service || "Online", s.uri || s.user || "")),
  );
  section(
    "Anniversary",
    anniversaries.map(a => {
      const date = a.date;
      let formatted = "";
      if (typeof date === "object" && date !== null) {
        if ("utc" in date && typeof date.utc === "string") formatted = date.utc;
        else {
          const parts: string[] = [];
          const pd = date as PartialDate;
          if (pd.year) parts.push(String(pd.year));
          if (pd.month) parts.push(String(pd.month).padStart(2, "0"));
          if (pd.day) parts.push(String(pd.day).padStart(2, "0"));
          formatted = parts.join("-");
        }
      } else if (date) {
        formatted = String(date);
      }
      return row(a.kind || "Date", formatted);
    }),
  );
  section("Notes", notes.map(n => row("", n.note || "")));

  const photoTag = photoUri
    ? `<img class="photo" src="${escapeHtml(photoUri)}" alt="" />`
    : `<div class="photo placeholder">${escapeHtml((name || "?").charAt(0).toUpperCase())}</div>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(name || "Contact")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 32px; }
  header { display: flex; align-items: center; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid #ccc; }
  .photo { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .photo.placeholder { background: #e5e7eb; color: #4b5563; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 600; }
  h1 { margin: 0; font-size: 22px; }
  section { margin-top: 20px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 0 0 8px; }
  dl { margin: 0; display: grid; grid-template-columns: 140px 1fr; row-gap: 6px; column-gap: 16px; font-size: 14px; }
  dt { color: #555; }
  dd { margin: 0; word-break: break-word; }
  @media print { body { margin: 16mm; } }
</style>
</head>
<body>
<header>
  ${photoTag}
  <div><h1>${escapeHtml(name || "Contact")}</h1></div>
</header>
${rows.join("")}
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
