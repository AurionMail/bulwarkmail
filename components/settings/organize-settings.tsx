"use client";

import { FolderSettings } from './folder-settings';
import { KeywordSettings } from './keyword-settings';
import { usePolicyStore } from '@/stores/policy-store';

/**
 * The Folders & tags page: what the sidebar lists and how mail is labelled.
 * The sidebar gears still deep-link to each half by section.
 */
export function OrganizeSettings() {
  const tagsEnabled = usePolicyStore((s) => s.isFeatureEnabled('customKeywordsEnabled'));
  return (
    <div className="space-y-8">
      <FolderSettings />
      {tagsEnabled && <KeywordSettings />}
    </div>
  );
}
