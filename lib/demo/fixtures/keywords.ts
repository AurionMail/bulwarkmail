import type { KeywordDefinition } from '@/stores/settings-store';

/**
 * The persona's tags. The mail fixtures set these as `$label:<id>` keywords;
 * demo login seeds the definitions into the settings store so the sidebar
 * shows them with names and colours instead of the built-in colour names.
 */
export const DEMO_KEYWORDS: KeywordDefinition[] = [
  { id: 'beacon', label: 'Beacon', color: 'purple' },
  { id: 'work', label: 'Work', color: 'blue' },
  { id: 'family', label: 'Family', color: 'pink' },
  { id: 'travel', label: 'Travel', color: 'orange' },
  { id: 'finance', label: 'Finance', color: 'green' },
  { id: 'follow-up', label: 'Follow-up', color: 'red' },
];
