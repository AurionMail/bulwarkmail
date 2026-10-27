import type { SettingsPolicy } from './types';

export interface KeyChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

/** What importing a policy file would change, for the preview before applying it. */
export interface PolicyChangeSummary {
  scopes: KeyChanges;
  features: KeyChanges;
  restrictions: KeyChanges;
  defaults: KeyChanges;
  /** Organisation sections, by name (signature, session...). */
  organisation: KeyChanges;
  /** Other top-level parts (theme policy, plugins, push relays, sidebar apps). */
  other: string[];
  /** Nothing would change. */
  unchanged: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function keyChanges(before: Record<string, unknown> = {}, after: Record<string, unknown> = {}): KeyChanges {
  const out: KeyChanges = { added: [], changed: [], removed: [] };
  for (const key of Object.keys(after)) {
    if (!(key in before)) out.added.push(key);
    else if (!same(before[key], after[key])) out.changed.push(key);
  }
  for (const key of Object.keys(before)) if (!(key in after)) out.removed.push(key);
  return out;
}

const empty = (c: KeyChanges) => c.added.length + c.changed.length + c.removed.length === 0;

/** Compares two complete policies (both as configManager stores them). */
export function summarizePolicyChange(current: SettingsPolicy, next: SettingsPolicy): PolicyChangeSummary {
  const byId = (policy: SettingsPolicy) => Object.fromEntries((policy.scopes ?? []).map((s) => [s.label ? `${s.label} (${s.id})` : s.id, s]));
  const summary: PolicyChangeSummary = {
    scopes: keyChanges(byId(current), byId(next)),
    features: keyChanges(current.features as unknown as Record<string, unknown>, next.features as unknown as Record<string, unknown>),
    restrictions: keyChanges(current.restrictions, next.restrictions),
    defaults: keyChanges(current.defaults, next.defaults),
    organisation: keyChanges(
      current.organisation as unknown as Record<string, unknown>,
      next.organisation as unknown as Record<string, unknown>,
    ),
    other: [],
    unchanged: false,
  };
  const covered = new Set(['scopes', 'features', 'restrictions', 'defaults', 'organisation']);
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    if (covered.has(key)) continue;
    if (!same((current as unknown as Record<string, unknown>)[key], (next as unknown as Record<string, unknown>)[key])) summary.other.push(key);
  }
  summary.unchanged = [summary.scopes, summary.features, summary.restrictions, summary.defaults, summary.organisation].every(empty)
    && summary.other.length === 0;
  return summary;
}
