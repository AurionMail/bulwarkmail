import { MAX_FUTURE_SENT_AT_MS } from "./email-date";

export interface ImportableEmail {
  name: string;
  blob: Blob;
  /**
   * The message's `Date` header as a JMAP UTCDate, passed as `receivedAt` on
   * Email/import. Without it the server stamps the import time and every
   * imported message looks like it arrived today (#891).
   */
  receivedAt?: string;
}

const EMAIL_MIME = "message/rfc822";

function isEmlName(name: string): boolean {
  return /\.eml$/i.test(name);
}

function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/** Only the header block is needed; don't decode a whole large message. */
const HEADER_SCAN_BYTES = 64 * 1024;

/**
 * Read the `Date` header of a raw RFC 5322 message and return it as a JMAP
 * UTCDate (no fractional seconds). Returns undefined when the header is
 * missing, unparsable, or more than a day in the future.
 */
export async function readMessageDate(blob: Blob, now: number = Date.now()): Promise<string | undefined> {
  const head = await blob.slice(0, HEADER_SCAN_BYTES).text();
  const end = head.search(/\r?\n\r?\n/);
  const headers = (end === -1 ? head : head.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const match = /^Date:[ \t]*(.+)$/im.exec(headers);
  if (!match) return undefined;
  // Drop RFC 5322 comments such as "(CEST)" before parsing.
  const value = match[1].replace(/\([^)]*\)/g, " ").trim();
  const time = Date.parse(value);
  if (Number.isNaN(time) || time - now > MAX_FUTURE_SENT_AT_MS) return undefined;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function extractEmlsFromZip(file: File): Promise<ImportableEmail[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: ImportableEmail[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    if (!isEmlName(entry.name)) continue;
    const data = await entry.async("arraybuffer");
    const blob = new Blob([data], { type: EMAIL_MIME });
    out.push({
      name: entry.name.split(/[\\/]/).pop() || entry.name,
      blob,
      receivedAt: await readMessageDate(blob),
    });
  }
  return out;
}

export async function expandImportableEmails(
  files: File[],
): Promise<ImportableEmail[]> {
  const out: ImportableEmail[] = [];
  for (const file of files) {
    if (isZipName(file.name) || file.type === "application/zip") {
      out.push(...(await extractEmlsFromZip(file)));
      continue;
    }
    const blob = new Blob([await file.arrayBuffer()], { type: EMAIL_MIME });
    out.push({ name: file.name, blob, receivedAt: await readMessageDate(blob) });
  }
  return out;
}

export const EML_IMPORT_ACCEPT = ".eml,.zip,message/rfc822,application/zip";
