// Host side of api.templates, api.identities and api.vacation: the message
// templates (kept in the browser and synced with the settings), the sender
// identities and the out-of-office reply. Changes go through the same stores
// and the same HTML sanitising as Settings, so what a plugin saves is held to
// the rules a user's own edit is.

import type {
  IdentityView, TemplateInput, VacationInput, VacationView, TemplateView,
} from '../plugin-types';
import type { EmailAddress, Identity } from '../jmap/types';
import { useTemplateStore } from '@/stores/template-store';
import { useIdentityStore } from '@/stores/identity-store';
import { useVacationStore } from '@/stores/vacation-store';
import { identityToView, templateToView, vacationToView } from '../plugin-projection';
import { sanitizeEmailHtml, sanitizePluginBodyHtml, sanitizeSignatureHtml } from '../email-sanitization';
import { htmlToPlainText } from '../html-to-text';
import { isPeriodBoundary } from '../sieve/period';
import {
  addressOf, nameOf, readAddressList, readBoolean, readId, readObject, readString, sessionClient,
} from './host-api-input';

// ─── Templates ────────────────────────────────────────────────

/** Templates a plugin may leave in the store; they all sync to the server. */
export const MAX_PLUGIN_TEMPLATES = 500;
const MAX_TEMPLATE_NAME = 200;
const MAX_TEMPLATE_CATEGORY = 100;
const MAX_TEMPLATE_SUBJECT = 998;
const MAX_TEMPLATE_BODY = 100_000;
const TEMPLATE_FIELDS = ['name', 'subject', 'body', 'isHTML', 'category'] as const;

export function doTemplatesList(): TemplateView[] {
  return useTemplateStore.getState().templates.map(templateToView);
}

export function doTemplatesGet(id: unknown): TemplateView | null {
  const templateId = readId(id, 'templates.get');
  const template = useTemplateStore.getState().templates.find((t) => t.id === templateId);
  return template ? templateToView(template) : null;
}

/** Template fields from a plugin; an HTML body is sanitised like a plugin-supplied body anywhere else. */
function templateFields(method: string, data: Record<string, unknown>, isHTML: boolean) {
  const out: { name?: string; subject?: string; body?: string; isHTML?: boolean; category?: string } = {};
  if (data.name !== undefined) out.name = readString(data.name, method, 'name', MAX_TEMPLATE_NAME, { min: 1, trim: true });
  if (data.subject !== undefined) out.subject = readString(data.subject, method, 'subject', MAX_TEMPLATE_SUBJECT);
  if (data.category !== undefined) {
    out.category = readString(data.category, method, 'category', MAX_TEMPLATE_CATEGORY, { trim: true });
  }
  if (data.isHTML !== undefined) out.isHTML = readBoolean(data.isHTML, method, 'isHTML');
  if (data.body !== undefined) {
    const body = readString(data.body, method, 'body', MAX_TEMPLATE_BODY);
    out.body = isHTML ? sanitizePluginBodyHtml(body) : body;
  }
  return out;
}

export function doTemplatesCreate(input: unknown): TemplateView {
  const method = 'templates.create';
  const data = readObject(input, method, 'template', TEMPLATE_FIELDS) as TemplateInput & Record<string, unknown>;
  if (data.name === undefined) throw new Error(`${method}: name is required`);
  const store = useTemplateStore.getState();
  if (store.templates.length >= MAX_PLUGIN_TEMPLATES) {
    throw new Error(`${method}: there are already ${MAX_PLUGIN_TEMPLATES} templates`);
  }
  const isHTML = data.isHTML === undefined ? false : readBoolean(data.isHTML, method, 'isHTML');
  const fields = templateFields(method, data, isHTML);
  const created = store.addTemplate({
    name: fields.name!,
    subject: fields.subject ?? '',
    body: fields.body ?? '',
    isHTML,
    category: fields.category ?? '',
    isFavorite: false,
  });
  return templateToView(created);
}

export function doTemplatesUpdate(id: unknown, patch: unknown): TemplateView {
  const method = 'templates.update';
  const templateId = readId(id, method);
  const data = readObject(patch, method, 'patch', TEMPLATE_FIELDS);
  if (Object.keys(data).length === 0) throw new Error(`${method}: patch is empty`);
  const existing = useTemplateStore.getState().templates.find((t) => t.id === templateId);
  if (!existing) throw new Error(`${method}: no template with id "${templateId}"`);
  const isHTML = data.isHTML === undefined ? !!existing.isHTML : readBoolean(data.isHTML, method, 'isHTML');
  const fields = templateFields(method, data, isHTML);
  // Turning an existing body into HTML must not let unsanitised text through.
  if (isHTML && !existing.isHTML && fields.body === undefined) fields.body = sanitizePluginBodyHtml(existing.body || '');
  useTemplateStore.getState().updateTemplate(templateId, fields);
  return templateToView(useTemplateStore.getState().templates.find((t) => t.id === templateId)!);
}

export function doTemplatesDelete(id: unknown): void {
  const method = 'templates.delete';
  const templateId = readId(id, method);
  if (!useTemplateStore.getState().templates.some((t) => t.id === templateId)) {
    throw new Error(`${method}: no template with id "${templateId}"`);
  }
  useTemplateStore.getState().deleteTemplate(templateId);
}

// ─── Identities ───────────────────────────────────────────────

const MAX_IDENTITY_NAME = 256;
const MAX_REPLY_TO = 10;
const MAX_TEXT_SIGNATURE = 20_000;
const MAX_HTML_SIGNATURE = 100_000;

/**
 * Change one sender identity's name, reply-to addresses or signatures. The
 * address itself can't be changed; an HTML signature is sanitised exactly
 * like one typed into Settings > Identities.
 */
export async function doIdentitiesUpdate(id: unknown, patch: unknown): Promise<IdentityView> {
  const method = 'identities.update';
  const identityId = readId(id, method);
  if (patch && typeof patch === 'object' && 'email' in patch) {
    throw new Error(`${method}: the address of an identity can't be changed`);
  }
  const data = readObject(patch, method, 'patch', ['name', 'replyTo', 'textSignature', 'htmlSignature']);
  if (Object.keys(data).length === 0) throw new Error(`${method}: patch is empty`);
  const identity = useIdentityStore.getState().identities.find((i) => i.id === identityId);
  if (!identity) throw new Error(`${method}: no identity with id "${identityId}"`);

  const updates: { name?: string; replyTo?: EmailAddress[] | null; textSignature?: string | null; htmlSignature?: string | null } = {};
  if (data.name !== undefined) updates.name = readString(data.name, method, 'name', MAX_IDENTITY_NAME, { trim: true });
  if (data.replyTo !== undefined) {
    const list = data.replyTo === null ? [] : readAddressList(data.replyTo, method, 'replyTo', MAX_REPLY_TO);
    updates.replyTo = list.length === 0
      ? null
      : list.map((entry) => ({ ...(nameOf(entry) ? { name: nameOf(entry) } : {}), email: addressOf(entry) }));
  }
  if (data.textSignature !== undefined) {
    const text = data.textSignature === null ? '' : readString(data.textSignature, method, 'textSignature', MAX_TEXT_SIGNATURE);
    // JMAP clears a field with null; an empty string would be stored as such.
    updates.textSignature = text.trim() ? text : null;
  }
  if (data.htmlSignature !== undefined) {
    const html = data.htmlSignature === null ? '' : readString(data.htmlSignature, method, 'htmlSignature', MAX_HTML_SIGNATURE);
    updates.htmlSignature = html.trim() ? sanitizeSignatureHtml(html) : null;
  }

  await sessionClient(method).updateIdentity(identityId, updates);
  useIdentityStore.getState().updateIdentityLocal(identityId, updates as Partial<Identity>);
  return identityToView({ ...identity, ...updates } as Identity);
}

// ─── Vacation ─────────────────────────────────────────────────

const MAX_VACATION_SUBJECT = 500;
const MAX_VACATION_BODY = 64_000;

function vacationClient(method: string) {
  const client = sessionClient(method);
  if (!client.supportsVacationResponse()) throw new Error(`${method}: the mail server has no out-of-office reply`);
  return client;
}

function vacationViewFromStore(): VacationView {
  const s = useVacationStore.getState();
  return vacationToView({
    id: 'singleton',
    isEnabled: s.isEnabled,
    fromDate: s.fromDate,
    toDate: s.toDate,
    subject: s.subject,
    textBody: s.textBody,
    htmlBody: s.htmlBody,
  });
}

export async function doVacationGet(): Promise<VacationView> {
  const method = 'vacation.get';
  const client = vacationClient(method);
  await useVacationStore.getState().fetchVacationResponse(client);
  const { error } = useVacationStore.getState();
  if (error) throw new Error(`${method}: ${error}`);
  return vacationViewFromStore();
}

function readMoment(value: unknown, method: string, field: string): string | null {
  if (value === null) return null;
  if (!isPeriodBoundary(value)) {
    throw new Error(`${method}: ${field} must be a date and time with a zone, such as 2026-05-01T00:00:00Z, or null`);
  }
  return new Date(value).toISOString();
}

/**
 * Turn the out-of-office reply on or off and set its text and dates. The
 * HTML body is sanitised like the one typed into Settings; without a text
 * body the text is derived from it. Resolves to the reply as saved, or null
 * when another plugin stopped the change.
 */
export async function doVacationSet(input: unknown): Promise<VacationView | null> {
  const method = 'vacation.set';
  const data = readObject(input, method, 'vacation', ['isEnabled', 'subject', 'textBody', 'htmlBody', 'fromDate', 'toDate']) as VacationInput & Record<string, unknown>;
  const updates: {
    isEnabled: boolean; subject?: string; textBody?: string; htmlBody?: string | null;
    fromDate?: string | null; toDate?: string | null;
  } = { isEnabled: readBoolean(data.isEnabled, method, 'isEnabled') };
  if (data.subject !== undefined) updates.subject = readString(data.subject, method, 'subject', MAX_VACATION_SUBJECT);
  if (data.textBody !== undefined) updates.textBody = readString(data.textBody, method, 'textBody', MAX_VACATION_BODY);
  if (data.htmlBody !== undefined) {
    const html = data.htmlBody === null ? '' : readString(data.htmlBody, method, 'htmlBody', MAX_VACATION_BODY);
    updates.htmlBody = html && htmlToPlainText(html).trim() ? sanitizeEmailHtml(html) : null;
    if (updates.htmlBody && updates.textBody === undefined) {
      updates.textBody = htmlToPlainText(updates.htmlBody, { paragraphSpacing: true });
    }
  }
  if (data.fromDate !== undefined) updates.fromDate = readMoment(data.fromDate, method, 'fromDate');
  if (data.toDate !== undefined) updates.toDate = readMoment(data.toDate, method, 'toDate');
  if (updates.fromDate && updates.toDate && updates.toDate <= updates.fromDate) {
    throw new Error(`${method}: toDate must be after fromDate`);
  }

  const client = vacationClient(method);
  // Returns false once the onBeforeVacationUpdate hook is wired into the
  // store and a plugin said no; nothing (undefined) before that.
  const outcome: unknown = await useVacationStore.getState().updateVacationResponse(client, updates);
  if (outcome === false) return null;
  return vacationViewFromStore();
}
