import { useMemo } from 'react';
import type { EmailTemplate } from '@/lib/template-types';
import type { TemplateSource } from '@/lib/templates/template-sources';
import { personalTemplatesFor, resolveAccountId } from '@/lib/templates/personal-templates';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore, type LocalOnlyReason } from '@/stores/account-templates-store';

/** What a change to a template came to; anything but 'ok' keeps the form open. */
export type TemplateSaveResult = 'ok' | 'too-large' | 'no-room' | 'forbidden' | 'failed';

export type { LocalOnlyReason };

type TemplateData = Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;

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
 * background; read-only sources refuse every change.
 */
export function useTemplateSourceActions(accountId?: string | null): TemplateSourceActions {
  const resolvedId = useAuthStore((s) => accountId || s.activeAccountId);
  const partition = useAccountTemplatesStore((s) => (resolvedId ? s.personal[resolvedId] : undefined));
  const storedInAccount = !!partition;
  const localOnly = partition?.localOnly ?? NO_LOCAL_ONLY;
  return useMemo(() => {
    const ops = () => personalTemplatesFor(resolveAccountId(resolvedId));
    const personalOnly = <A extends unknown[]>(fn: (...args: A) => void) =>
      async (source: TemplateSource, ...args: A): Promise<TemplateSaveResult> => {
        if (source.kind !== 'personal' || !source.editable) return 'forbidden';
        fn(...args);
        return 'ok';
      };
    return {
      add: personalOnly((data: TemplateData) => { ops().add(data); }),
      update: personalOnly((id: string, data: TemplateData) => ops().update(id, data)),
      remove: personalOnly((id: string) => ops().remove(id)),
      duplicate: personalOnly((id: string, suffix: string) => { ops().duplicate(id, suffix); }),
      toggleFavorite: personalOnly((id: string) => ops().toggleFavorite(id)),
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
