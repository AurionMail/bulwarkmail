import { useMemo } from 'react';
import type { EmailTemplate } from '@/lib/template-types';
import type { TemplateSaveResult, TemplateSource } from '@/lib/templates/template-sources';
import type { TemplateData } from '@/lib/templates/template-reducer';
import { personalTemplatesFor } from '@/lib/templates/personal-templates';
import { deleteTeamTemplate, saveTeamTemplate } from '@/lib/templates/team-templates';
import { generateUUID } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore, type LocalOnlyReason } from '@/stores/account-templates-store';

export type { LocalOnlyReason, TemplateSaveResult };

export interface TemplateSourceActions {
  add: (source: TemplateSource, data: TemplateData) => Promise<TemplateSaveResult>;
  update: (source: TemplateSource, id: string, data: TemplateData) => Promise<TemplateSaveResult>;
  remove: (source: TemplateSource, id: string) => Promise<TemplateSaveResult>;
  duplicate: (source: TemplateSource, id: string, nameSuffix: string) => Promise<TemplateSaveResult>;
  toggleFavorite: (source: TemplateSource, id: string) => Promise<TemplateSaveResult>;
  /** A read-only (organisation or team) template copied into the user's own. */
  copyToPersonal: (template: EmailTemplate) => Promise<TemplateSaveResult>;
  /** Personal templates that stay in this browser, by id. */
  localOnly: Record<string, LocalOnlyReason>;
  /** Personal templates live in the account (server metadata), not only in this browser. */
  storedInAccount: boolean;
}

const NO_LOCAL_ONLY: Record<string, LocalOnlyReason> = {};

/**
 * Changes to the templates of each source the manager shows, for the
 * signed-in account `accountId` (the active one when left out). Personal
 * templates change in this browser at once and go to the account in the
 * background; team templates are written to the group's Inbox at once;
 * read-only sources refuse every change.
 */
export function useTemplateSourceActions(accountId?: string | null): TemplateSourceActions {
  const resolvedId = useAuthStore((s) => accountId || s.activeAccountId);
  const partition = useAccountTemplatesStore((s) => (resolvedId ? s.personal[resolvedId] : undefined));
  const storedInAccount = !!partition;
  const localOnly = partition?.localOnly ?? NO_LOCAL_ONLY;
  return useMemo(() => {
    const ops = () => personalTemplatesFor(resolvedId);
    const group = (source: TemplateSource) => source.key.slice('team:'.length);
    const find = (source: TemplateSource, id: string) => source.templates.find((t) => t.id === id);
    const team = (source: TemplateSource, template: EmailTemplate, base: string | null): Promise<TemplateSaveResult> =>
      resolvedId ? saveTeamTemplate(resolvedId, group(source), template, base) : Promise.resolve('failed');
    const fresh = (data: TemplateData): EmailTemplate => {
      const at = new Date().toISOString();
      return { ...data, id: generateUUID(), createdAt: at, updatedAt: at };
    };
    return {
      add: async (source, data) => {
        if (!source.editable) return 'forbidden';
        if (source.kind === 'personal') {
          ops().add(data);
          return 'ok';
        }
        return source.kind === 'team' ? team(source, fresh(data), null) : 'forbidden';
      },
      update: async (source, id, data) => {
        if (!source.editable) return 'forbidden';
        if (source.kind === 'personal') {
          ops().update(id, data);
          return 'ok';
        }
        const existing = find(source, id);
        if (source.kind !== 'team' || !existing) return 'forbidden';
        return team(source, { ...existing, ...data, id, updatedAt: new Date().toISOString() }, existing.updatedAt);
      },
      remove: async (source, id) => {
        if (!source.editable) return 'forbidden';
        if (source.kind === 'personal') {
          ops().remove(id);
          return 'ok';
        }
        const existing = find(source, id);
        if (source.kind !== 'team' || !existing || !resolvedId) return 'forbidden';
        return deleteTeamTemplate(resolvedId, group(source), id, existing.updatedAt);
      },
      duplicate: async (source, id, suffix) => {
        if (!source.editable) return 'forbidden';
        if (source.kind === 'personal') {
          ops().duplicate(id, suffix);
          return 'ok';
        }
        const existing = find(source, id);
        if (source.kind !== 'team' || !existing) return 'forbidden';
        return team(source, fresh({ ...copyOf(existing), name: `${existing.name} ${suffix}` }), null);
      },
      toggleFavorite: async (source, id) => {
        if (source.kind !== 'personal' || !source.editable) return 'forbidden';
        ops().toggleFavorite(id);
        return 'ok';
      },
      copyToPersonal: async (template) => {
        ops().add(copyOf(template));
        return 'ok';
      },
      localOnly,
      storedInAccount,
    };
  }, [resolvedId, localOnly, storedInAccount]);
}

/** The fields a copy of a shared template takes into the user's own list. */
export function copyOf(template: EmailTemplate): TemplateData {
  return {
    name: template.name,
    subject: template.subject,
    body: template.body,
    isHTML: template.isHTML,
    category: template.category,
    defaultRecipients: template.defaultRecipients,
    isFavorite: false,
  };
}
