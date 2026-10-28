/**
 * The changes a user makes to a list of their own templates, as pure
 * functions over `{ templates, deletedTemplateIds }`. The browser's list
 * (template-store) and an account's copy (account-templates-store) both use
 * them, so both behave the same.
 *
 * Every change moves `updatedAt` forward from the template's previous value
 * even when this device's clock is behind the one that wrote it last;
 * otherwise the merge by `updatedAt` would throw the change away.
 */

import type { EmailTemplate } from '@/lib/template-types';
import { generateUUID } from '@/lib/utils';

export interface TemplateListState {
  templates: EmailTemplate[];
  deletedTemplateIds: Record<string, string>;
}

export type TemplateData = Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;
export type TemplateUpdate = Partial<Omit<EmailTemplate, 'id' | 'createdAt'>>;

/** `updatedAt` for a change: now, or just after the previous value if that is later. */
export function nextUpdatedAt(previous?: string, now: number = Date.now()): string {
  const before = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isNaN(before) ? now : Math.max(now, before + 1)).toISOString();
}

export function addTemplate(state: TemplateListState, data: TemplateData, now = Date.now()): { state: TemplateListState; template: EmailTemplate } {
  const at = new Date(now).toISOString();
  const template: EmailTemplate = { ...data, id: generateUUID(), createdAt: at, updatedAt: at };
  return { state: { ...state, templates: [...state.templates, template] }, template };
}

export function updateTemplate(state: TemplateListState, id: string, updates: TemplateUpdate, now = Date.now()): TemplateListState {
  return {
    ...state,
    templates: state.templates.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: nextUpdatedAt(t.updatedAt, now) } : t)),
  };
}

export function toggleFavorite(state: TemplateListState, id: string, now = Date.now()): TemplateListState {
  return {
    ...state,
    templates: state.templates.map((t) => (t.id === id ? { ...t, isFavorite: !t.isFavorite, updatedAt: nextUpdatedAt(t.updatedAt, now) } : t)),
  };
}

/** Removes a template and leaves a tombstone newer than the template, so the deletion wins the merge. */
export function deleteTemplate(state: TemplateListState, id: string, now = Date.now()): TemplateListState {
  const template = state.templates.find((t) => t.id === id);
  if (!template) return state;
  return {
    templates: state.templates.filter((t) => t.id !== id),
    deletedTemplateIds: { ...state.deletedTemplateIds, [id]: nextUpdatedAt(template.updatedAt, now) },
  };
}

export function duplicateTemplate(
  state: TemplateListState,
  id: string,
  nameSuffix?: string,
  now = Date.now(),
): { state: TemplateListState; template: EmailTemplate } | null {
  const original = state.templates.find((t) => t.id === id);
  if (!original) return null;
  const { id: _id, createdAt: _c, updatedAt: _u, ...data } = original;
  void _id; void _c; void _u;
  return addTemplate(state, { ...data, name: `${original.name} ${nameSuffix || '(copy)'}`, isFavorite: false }, now);
}

export function appendTemplates(state: TemplateListState, templates: EmailTemplate[]): TemplateListState {
  return { ...state, templates: [...state.templates, ...templates] };
}
