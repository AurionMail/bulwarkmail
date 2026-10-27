/**
 * The organisation part of the user policy (policy.json `organisation`):
 * settings an admin makes for everyone, as opposed to the per-setting
 * restrictions. Every section has one default that works without
 * configuration, and every section can be overridden per domain or group
 * through `scopes` (lib/admin/policy-scopes.ts).
 *
 * policy.json is written by hand and Lite reads it as a static file, so
 * sanitizeOrganisationPolicy accepts any input and keeps only known keys
 * with the right type, falling back to the default for each.
 */

import type { EmailTemplate } from '@/lib/template-types';

/** Details a user fills in once for the organisation signature. */
export const SIGNATURE_FIELDS = ['title', 'department', 'phone', 'mobile'] as const;
export type SignatureField = (typeof SIGNATURE_FIELDS)[number];

/** A template of the admin library: read-only for users. */
export type OrgTemplate = Pick<EmailTemplate, 'id' | 'name' | 'subject' | 'body' | 'isHTML' | 'category'>;

export interface OrganisationPolicy {
  externalMail: {
    /** "External" chip on mail from senders outside the organisation domains. */
    senderLabel: boolean;
    /** Confirm before sending to recipients outside the organisation domains. */
    recipientWarning: boolean;
    /** Organisation domains; empty means the domains of the user's identities. Subdomains match. */
    domains: string[];
    /** Recipients in the user's contacts don't trigger the warning. */
    trustContacts: boolean;
  };
  signature: {
    /** HTML template with placeholders; empty html and text mean no organisation signature. */
    html: string;
    text: string;
    /** The details users fill in, as the template uses them. */
    fields: SignatureField[];
  };
  disclaimer: {
    /** Added below everything when a message is sent; empty means none. */
    html: string;
    text: string;
  };
  templates: {
    library: OrgTemplate[];
  };
  session: {
    /** Sign out after this many minutes without activity; 0 is off. */
    idleMinutes: number;
    /** Sign out this many hours after signing in; 0 is off. */
    maxHours: number;
    /** How long the warning counts down before signing out. */
    warnSeconds: number;
  };
  recovery: {
    /** How far back "Recover deleted items" lists; 0 is everything the server keeps. */
    days: number;
  };
}

export const DEFAULT_ORGANISATION_POLICY: OrganisationPolicy = {
  externalMail: { senderLabel: false, recipientWarning: false, domains: [], trustContacts: true },
  signature: { html: '', text: '', fields: [] },
  disclaimer: { html: '', text: '' },
  templates: { library: [] },
  session: { idleMinutes: 0, maxHours: 0, warnSeconds: 60 },
  recovery: { days: 0 },
};

export type OrganisationSection = keyof OrganisationPolicy;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const MAX_TEXT = 64 * 1024;
const MAX_LIBRARY = 200;
const MAX_DOMAINS = 500;
// Same shape as the branding host rule, without the wildcard: a bare domain.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function count(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Lowercased, trimmed, deduplicated domains; "@example.com" and "*.example.com" are taken as example.com. */
export function normalizeDomainList(value: unknown): string[] | undefined {
  const raw = typeof value === 'string' ? value.split(/[\s,;]+/) : Array.isArray(value) ? value : undefined;
  if (!raw) return undefined;
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const domain = item.trim().toLowerCase().replace(/^\*\./, '').replace(/^@/, '').replace(/\.+$/, '');
    if (domain && DOMAIN_RE.test(domain)) out.add(domain);
    if (out.size >= MAX_DOMAINS) break;
  }
  return [...out];
}

function sanitizeLibrary(value: unknown): OrgTemplate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: OrgTemplate[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 128) : '';
    const name = text(item.name)?.trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, 200),
      subject: text(item.subject) ?? '',
      body: text(item.body) ?? '',
      isHTML: item.isHTML === true,
      category: (text(item.category) ?? '').slice(0, 100),
    });
    if (out.length >= MAX_LIBRARY) break;
  }
  return out;
}

/**
 * The parts of `raw` that are valid organisation settings, without
 * defaults filled in. Used for scope overrides, where a missing key means
 * "inherit", and as the first step of sanitizeOrganisationPolicy.
 */
export function sanitizeOrganisationPartial(raw: unknown): DeepPartial<OrganisationPolicy> {
  if (!isRecord(raw)) return {};
  const out: DeepPartial<OrganisationPolicy> = {};
  const section = (key: OrganisationSection) => (isRecord(raw[key]) ? (raw[key] as Record<string, unknown>) : null);
  const assign = <S extends OrganisationSection>(key: S, values: Record<string, unknown>) => {
    const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    if (Object.keys(kept).length > 0) (out as Record<string, unknown>)[key] = kept;
  };

  const ext = section('externalMail');
  if (ext) assign('externalMail', {
    senderLabel: bool(ext.senderLabel),
    recipientWarning: bool(ext.recipientWarning),
    domains: normalizeDomainList(ext.domains),
    trustContacts: bool(ext.trustContacts),
  });

  const sig = section('signature');
  if (sig) assign('signature', {
    html: text(sig.html),
    text: text(sig.text),
    fields: Array.isArray(sig.fields)
      ? SIGNATURE_FIELDS.filter((field) => (sig.fields as unknown[]).includes(field))
      : undefined,
  });

  const disc = section('disclaimer');
  if (disc) assign('disclaimer', { html: text(disc.html), text: text(disc.text) });

  const tpl = section('templates');
  if (tpl) assign('templates', { library: sanitizeLibrary(tpl.library) });

  const ses = section('session');
  if (ses) assign('session', {
    idleMinutes: count(ses.idleMinutes, 7 * 24 * 60),
    maxHours: count(ses.maxHours, 24 * 365),
    warnSeconds: count(ses.warnSeconds, 600),
  });

  const rec = section('recovery');
  if (rec) assign('recovery', { days: count(rec.days, 3650) });

  return out;
}

/** Merges `override` into `base` per leaf of plain objects; arrays and values replace. */
export function mergeOrganisation(
  base: OrganisationPolicy,
  override: DeepPartial<OrganisationPolicy>,
): OrganisationPolicy {
  const out = { ...base } as Record<string, Record<string, unknown>>;
  for (const [sectionKey, values] of Object.entries(override)) {
    if (!isRecord(values) || !isRecord(out[sectionKey])) continue;
    const merged = { ...out[sectionKey] };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (sectionKey === 'templates' && key === 'library' && Array.isArray(value)) {
        // The one array that adds up: a scope's templates join the ones it
        // inherits; the same id replaces the inherited template.
        const byId = new Map((merged.library as OrgTemplate[]).map((t) => [t.id, t]));
        for (const template of value as OrgTemplate[]) byId.set(template.id, template);
        merged.library = [...byId.values()];
      } else {
        merged[key] = value;
      }
    }
    out[sectionKey] = merged;
  }
  return out as unknown as OrganisationPolicy;
}

/** A complete organisation policy from anything: defaults for whatever is missing or invalid. */
export function sanitizeOrganisationPolicy(raw: unknown): OrganisationPolicy {
  return mergeOrganisation(DEFAULT_ORGANISATION_POLICY, sanitizeOrganisationPartial(raw));
}
