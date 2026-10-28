/**
 * The organisation signature (policy.json `organisation.signature`): an
 * admin's HTML and plain-text template, filled in per identity with the
 * identity's name and address, the company name and the details each user
 * fills in once (title, department, phone, mobile).
 *
 * - Values are inserted as text, so they are HTML-escaped in the HTML
 *   template (also inside attributes such as `href="tel:{phone}"`).
 * - A line whose placeholders are all empty is dropped, so a user without
 *   a mobile number gets no stray "Mobile:" line. In HTML a line is a run
 *   of content between `<br>`s or block boundaries; a table row counts as
 *   one line.
 *
 * Which signature an identity gets (effectiveSignatureIdentity):
 * - no restriction: the organisation signature is the default for
 *   identities without a signature of their own;
 * - `signature` locked or hidden: it replaces every identity's signature.
 *
 * Pure functions only; the parts that read the stores are in
 * lib/org/signature-state.ts and hooks/use-org-signature.ts.
 */

import type { Identity } from '@/lib/jmap/types';
import type { SettingRestriction } from '@/lib/admin/types';
import { SIGNATURE_FIELDS, type OrganisationPolicy, type SignatureField } from '@/lib/admin/organisation-policy';

export const SIGNATURE_PLACEHOLDERS = [
  'name',
  'email',
  'identity',
  'company',
  'domain',
  'title',
  'department',
  'phone',
  'mobile',
] as const;
export type SignaturePlaceholder = (typeof SIGNATURE_PLACEHOLDERS)[number];
export type SignatureValues = Partial<Record<SignaturePlaceholder, string>>;

/** What a user fills in once for the organisation signature (settings key `signatureDetails`). */
export type SignatureDetails = Record<SignatureField, string>;

export const EMPTY_SIGNATURE_DETAILS: SignatureDetails = { title: '', department: '', phone: '', mobile: '' };

const MAX_DETAIL_LENGTH = 200;

/** Keeps the four known fields as trimmed-length strings; anything else is dropped. */
export function sanitizeSignatureDetails(raw: unknown): SignatureDetails {
  const out = { ...EMPTY_SIGNATURE_DETAILS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const field of SIGNATURE_FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value === 'string') out[field] = value.slice(0, MAX_DETAIL_LENGTH);
  }
  return out;
}

const PLACEHOLDER_RE = /\{(name|email|identity|company|domain|title|department|phone|mobile)\}/g;

/** The placeholders a template uses, each once, in the order they appear. */
export function placeholdersIn(template: string): SignaturePlaceholder[] {
  const found = new Set<SignaturePlaceholder>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) found.add(match[1] as SignaturePlaceholder);
  return [...found];
}

/** The user details the templates ask for, in the order of SIGNATURE_FIELDS. */
export function signatureFieldsUsed(signature: { html: string; text: string }): SignatureField[] {
  const used = new Set<string>([...placeholdersIn(signature.html), ...placeholdersIn(signature.text)]);
  return SIGNATURE_FIELDS.filter((field) => used.has(field));
}

/**
 * The fields users are asked for: what the admin listed plus what the
 * templates use, so a hand-written policy.json without `fields` still asks.
 */
export function signatureFieldsToAsk(signature: OrganisationPolicy['signature']): SignatureField[] {
  const used = new Set<SignatureField>([...signature.fields, ...signatureFieldsUsed(signature)]);
  return SIGNATURE_FIELDS.filter((field) => used.has(field));
}

const valueOf = (values: SignatureValues, key: string) => (values[key as SignaturePlaceholder] ?? '').trim();

function fillString(template: string, values: SignatureValues): string {
  return template.replace(PLACEHOLDER_RE, (_, key: string) => valueOf(values, key));
}

/** True when the text has placeholders and every one of them is empty. */
function allPlaceholdersEmpty(keys: string[], values: SignatureValues): boolean {
  return keys.length > 0 && keys.every((key) => !valueOf(values, key));
}

/** Fills a plain-text template; lines whose placeholders are all empty are dropped. */
export function fillTextTemplate(template: string, values: SignatureValues): string {
  return template
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !allPlaceholdersEmpty(placeholdersIn(line), values))
    .map((line) => fillString(line, values))
    .join('\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DIV', 'DL', 'DT', 'FOOTER', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
  'THEAD', 'TR', 'UL',
]);

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isBlock = (node: Node) => isElement(node) && BLOCK_TAGS.has(node.tagName);

/** Placeholders in the text and the attributes of `nodes`. */
function placeholdersOfNodes(nodes: Node[]): string[] {
  const keys: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      keys.push(...placeholdersIn(node.textContent ?? ''));
      return;
    }
    if (!isElement(node)) return;
    for (const attr of Array.from(node.attributes)) keys.push(...placeholdersIn(attr.value));
    node.childNodes.forEach(visit);
  };
  nodes.forEach(visit);
  return keys;
}

const hasVisibleContent = (el: Element) =>
  (el.textContent ?? '').trim().length > 0 || el.querySelector('img, hr, svg') !== null;

/**
 * Removes the lines of `el` whose placeholders are all empty, deepest
 * blocks first. A block that had placeholders and is empty afterwards goes
 * too, so "<p>{mobile}</p>" leaves no empty paragraph.
 */
function dropEmptyLines(el: Element, values: SignatureValues, isRoot: boolean): void {
  const hadPlaceholders = placeholdersOfNodes([el]).length > 0;
  if (!hadPlaceholders) return;
  // A table row is one line: "Phone: | {phone}" goes as a whole.
  if (el.tagName === 'TR' && allPlaceholdersEmpty(placeholdersOfNodes([el]), values)) {
    el.remove();
    return;
  }
  Array.from(el.children).forEach((child) => {
    if (BLOCK_TAGS.has(child.tagName)) dropEmptyLines(child, values, false);
  });

  // Each line, with the <br> that ends it; `block` when a block ends it.
  const runs: Array<{ nodes: Node[]; br: Element | null; block?: boolean }> = [];
  let run: Node[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (isBlock(node)) {
      runs.push({ nodes: run, br: null, block: true });
      run = [];
    } else if (isElement(node) && node.tagName === 'BR') {
      runs.push({ nodes: run, br: node });
      run = [];
    } else {
      run.push(node);
    }
  }
  runs.push({ nodes: run, br: null });

  runs.forEach((line, index) => {
    if (!allPlaceholdersEmpty(placeholdersOfNodes(line.nodes), values)) return;
    line.nodes.forEach((node) => node.parentNode?.removeChild(node));
    // The line break that belonged to the line goes with it: the one after
    // it, or for the last line the one before it that is still there.
    if (line.br) {
      line.br.remove();
      return;
    }
    for (let j = index - 1; j >= 0 && !runs[j].block; j--) {
      const previous = runs[j].br;
      if (previous?.parentNode) {
        previous.remove();
        break;
      }
    }
  });

  if (!isRoot && !hasVisibleContent(el)) el.remove();
}

function fillNodes(root: Element, values: SignatureValues): void {
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (placeholdersIn(text).length > 0) node.textContent = fillString(text, values);
      return;
    }
    if (!isElement(node)) return;
    for (const attr of Array.from(node.attributes)) {
      if (placeholdersIn(attr.value).length > 0) node.setAttribute(attr.name, fillString(attr.value, values));
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
}

/**
 * Fills an HTML template. Values go in as text (escaped when serialised);
 * lines whose placeholders are all empty are dropped. The result still goes
 * through the signature sanitizer wherever it is inserted.
 */
export function fillHtmlTemplate(template: string, values: SignatureValues): string {
  if (typeof DOMParser === 'undefined') {
    // Server render: no DOM. Nothing calls this there for real; escape at least.
    return template.replace(PLACEHOLDER_RE, (_, key: string) => escapeHtml(valueOf(values, key))).trim();
  }
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${template}</body></html>`, 'text/html');
  dropEmptyLines(doc.body, values, true);
  fillNodes(doc.body, values);
  return doc.body.innerHTML.trim();
}

/** The placeholder values for one identity. */
export function signatureValuesFor(
  identity: Pick<Identity, 'name' | 'email'> | null | undefined,
  details: Partial<SignatureDetails> | null | undefined,
  company: string,
): SignatureValues {
  const email = identity?.email?.trim() ?? '';
  const name = identity?.name?.trim() ?? '';
  const at = email.lastIndexOf('@');
  return {
    name,
    email,
    identity: name && email ? `${name} <${email}>` : name || email,
    company: company.trim(),
    domain: at >= 0 ? email.slice(at + 1).toLowerCase() : '',
    title: details?.title ?? '',
    department: details?.department ?? '',
    phone: details?.phone ?? '',
    mobile: details?.mobile ?? '',
  };
}

export interface FilledSignature {
  html: string;
  text: string;
}

/** The organisation signature filled in, or null when the admin set none. */
export function buildOrgSignature(
  signature: Pick<OrganisationPolicy['signature'], 'html' | 'text'> | null | undefined,
  values: SignatureValues,
): FilledSignature | null {
  const html = signature?.html?.trim() ?? '';
  const text = signature?.text?.trim() ?? '';
  if (!html && !text) return null;
  return {
    html: html ? fillHtmlTemplate(html, values) : '',
    text: text ? fillTextTemplate(text, values) : '',
  };
}

/** How the `signature` restriction applies: `enforced` when locked or hidden. */
export interface SignatureRestriction {
  locked: boolean;
  hidden: boolean;
}

export function signatureRestriction(restriction: SettingRestriction | undefined): SignatureRestriction {
  return { locked: restriction?.locked === true, hidden: restriction?.hidden === true };
}

export const isSignatureEnforced = (r: SignatureRestriction) => r.locked || r.hidden;

const hasSignature = (identity: Pick<Identity, 'htmlSignature' | 'textSignature'> | null | undefined) =>
  !!(identity?.htmlSignature?.trim() || identity?.textSignature?.trim());

/**
 * The identity whose signature the composer inserts, with the organisation
 * signature applied. `own` is what the composer would sign with on its own
 * (the identity, or the primary one standing in for an identity without a
 * signature); `sending` is the identity the message goes out from, whose
 * name and address the organisation signature is filled in for.
 *
 * Returns `own` itself when the organisation signature doesn't apply, so
 * the composer behaves exactly as without one.
 */
export function effectiveSignatureIdentity<T extends Identity>(
  own: T | null | undefined,
  sending: T | null | undefined,
  orgSignature: FilledSignature | null,
  restriction: SignatureRestriction,
): T | null | undefined {
  if (!orgSignature) return own;
  if (!isSignatureEnforced(restriction) && hasSignature(own)) return own;
  const base = sending ?? own;
  if (!base) return own;
  return { ...base, htmlSignature: orgSignature.html, textSignature: orgSignature.text };
}
