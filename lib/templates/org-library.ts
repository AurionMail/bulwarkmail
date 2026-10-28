/**
 * The admin's template library (policy.json `organisation.templates.library`)
 * as templates the picker and the template manager show under
 * "Organisation". Users can't change them; scopes add to Everyone's library
 * by id (mergeOrganisation), so the effective policy already holds the
 * list for the user's domain and groups.
 */

import type { SettingsPolicy } from '@/lib/admin/types';
import type { EmailTemplate } from '@/lib/template-types';
import { parseSyncedTemplates } from '@/lib/template-utils';

export function orgLibraryTemplates(policy: Pick<SettingsPolicy, 'organisation'> | null | undefined): EmailTemplate[] {
  const library = policy?.organisation?.templates?.library ?? [];
  if (library.length === 0) return [];
  // The same validation and HTML sanitising as a synced template of the
  // user's own, so an admin's HTML body reaches the editor cleaned too.
  return (parseSyncedTemplates(library) ?? []).map((template) => ({
    ...template,
    defaultRecipients: undefined,
    identityId: undefined,
    isFavorite: false,
    createdAt: '',
    updatedAt: '',
  }));
}
