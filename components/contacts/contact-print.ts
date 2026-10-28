import type { ContactCard } from "@/lib/jmap/types";
import { formatContactDate } from "@/lib/contact-dates";
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

/** The print sheet's words, in the UI language. */
export interface PrintLabels {
  locale: string;
  contact: string;
  emails: string;
  email: string;
  phones: string;
  phone: string;
  organizations: string;
  organization: string;
  titles: string;
  title: string;
  role: string;
  addresses: string;
  address: string;
  online: string;
  onlineService: string;
  anniversaries: string;
  anniversary: (kind: string) => string;
  notes: string;
}

/** The print labels from the contacts translations (`t` of the "contacts" namespace). */
export function printLabels(t: (key: string) => string, locale: string): PrintLabels {
  return {
    locale,
    contact: t("detail.section_contact"),
    emails: t("detail.emails"),
    email: t("detail.email_default_label"),
    phones: t("detail.phones"),
    phone: t("detail.phone_default_label"),
    organizations: t("detail.organizations"),
    organization: t("detail.organization_label"),
    titles: t("detail.titles"),
    title: t("detail.title_label"),
    role: t("detail.role_label"),
    addresses: t("detail.addresses"),
    address: t("detail.address_default_label"),
    online: t("detail.online_services"),
    onlineService: t("detail.online_service_default_label"),
    anniversaries: t("detail.anniversaries"),
    anniversary: (kind) => t(`detail.anniversary_${["birth", "death", "wedding"].includes(kind) ? kind : "other"}`),
    notes: t("detail.notes"),
  };
}

const PRINT_FRAME_ATTR = "data-contact-print-frame";

/**
 * Prints the sheet from a hidden frame in this page, for when the browser
 * blocked the print window. The frame goes away after printing, or when the
 * next sheet is printed.
 */
function printInFrame(html: string): void {
  document.querySelectorAll(`iframe[${PRINT_FRAME_ATTR}]`).forEach((f) => f.remove());
  const frame = document.createElement("iframe");
  frame.setAttribute(PRINT_FRAME_ATTR, "");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  // Printed once the sheet and its photo have loaded. Some browsers report
  // the frame's empty start page first; that one is skipped.
  let printed = false;
  frame.addEventListener("load", () => {
    const frameWindow = frame.contentWindow;
    if (printed || !frameWindow || !frame.contentDocument?.querySelector("h1")) return;
    printed = true;
    frameWindow.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 0), { once: true });
    frameWindow.focus();
    frameWindow.print();
  });
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

export async function printContact(contact: ContactCard, labels: PrintLabels, displayName?: string): Promise<void> {
  // Open the window before anything is awaited: browsers allow the popup only
  // while the click that asked for it is being handled. When the popup is
  // blocked, the sheet is printed from a hidden frame instead.
  const printWindow = window.open("", "_blank");

  const name = displayName || getContactDisplayName(contact);
  const photoUri = await printablePhotoUri(contact);
  if (printWindow?.closed) return;
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

  section(labels.emails, emails.map(e => row(e.label || labels.email, e.address || "")));
  section(labels.phones, phones.map(p => row(p.label || labels.phone, p.number || "")));
  section(
    labels.organizations,
    orgs.map(o => {
      const units = o.units ? Object.values(o.units).map(u => u.name).filter(Boolean).join(", ") : "";
      const value = [o.name, units].filter(Boolean).join(" \u2014 ");
      return row(labels.organization, value);
    }),
  );
  section(labels.titles, titles.map(t => row(t.kind === "role" ? labels.role : labels.title, t.name || "")));
  section(
    labels.addresses,
    addresses.map(a => {
      const parts = [a.street, a.locality, a.region, a.postcode, a.country]
        .map(p => (typeof p === "string" ? p : ""))
        .filter(Boolean);
      return row(a.label || labels.address, parts.join(", "));
    }),
  );
  section(
    labels.online,
    onlineServices.map(s => row(s.label || s.service || labels.onlineService, s.uri || s.user || "")),
  );
  section(
    labels.anniversaries,
    anniversaries.map(a => row(labels.anniversary(a.kind || "other"), a.date ? formatContactDate(a.date, labels.locale) : "")),
  );
  section(labels.notes, notes.map(n => row("", n.note || "")));

  const photoTag = photoUri
    ? `<img class="photo" src="${escapeHtml(photoUri)}" alt="" />`
    : `<div class="photo placeholder">${escapeHtml((name || "?").charAt(0).toUpperCase())}</div>`;

  const html = `<!doctype html>
<html lang="${escapeHtml(labels.locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(name || labels.contact)}</title>
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
  <div><h1>${escapeHtml(name || labels.contact)}</h1></div>
</header>
${rows.join("")}
</body>
</html>`;

  if (!printWindow) {
    printInFrame(html);
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
