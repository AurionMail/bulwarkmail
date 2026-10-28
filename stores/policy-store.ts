import { create } from 'zustand';
import type { SettingsPolicy, FeatureGates, SettingRestriction, ThemePolicy, ColorMode } from '@/lib/admin/types';
import { DEFAULT_POLICY, DEFAULT_THEME_POLICY, POLICY_DOMAINS_HEADER, POLICY_SCOPE_HEADER } from '@/lib/admin/types';
import { apiFetch } from '@/lib/browser-navigation';
import { IS_LITE, IS_LITE_STALWART, LITE_POLICY_PATH, withLiteBuildId } from '@/lib/lite';
import { applyLitePolicy } from '@/lib/lite-config';
import { resolvePolicy, type PolicySource, type PolicySubject } from '@/lib/admin/policy-scopes';
import { DEFAULT_ORGANISATION_POLICY, type OrganisationPolicy } from '@/lib/admin/organisation-policy';

interface PolicyState {
  /**
   * The effective policy for the active account: the policy as fetched with
   * the domain and group scopes that match the account applied. Everything
   * that reads the policy reads this.
   */
  policy: SettingsPolicy;
  /** The policy as fetched, scopes included. */
  rawPolicy: SettingsPolicy;
  /** The account `policy` was resolved for; null before one is known. */
  subject: PolicySubject | null;
  /** Ids of the scopes that apply to `subject`. */
  matchedScopes: string[];
  /** What set each non-default value of `policy` (see ResolvedPolicy.sources). */
  sources: Record<string, PolicySource>;
  /**
   * The domains the server picked the scopes for, or null when it sent all
   * of them. An account of another domain needs a fresh fetch.
   */
  scopeDomains: string[] | null;
  /** Whether the fetched scopes cover this address's domain. */
  coversAddress: (email: string) => boolean;
  loaded: boolean;
  /**
   * The server answered with the public subset (not signed in yet); the
   * full policy is fetched again once a session exists.
   */
  partial: boolean;
  /**
   * Gates the demo switches on regardless of the deployment's policy, so the
   * demo's two accounts and shared mailbox can show the merged views. Set by
   * the demo login only; empty everywhere else.
   */
  demoFeatureOverrides: Partial<FeatureGates>;
  setDemoFeatureOverrides: (overrides: Partial<FeatureGates>) => void;
  fetchPolicy: () => Promise<void>;
  /** Resolve the policy for this account (the active one); null for none. */
  setPolicySubject: (subject: PolicySubject | null) => void;
  /** The effective policy of another account, without making it the active one. */
  resolveFor: (subject: PolicySubject | null) => SettingsPolicy;
  /** The organisation settings of the effective policy. */
  getOrganisation: () => OrganisationPolicy;
  /** `global`, a scope id, or `default` when nothing set it. */
  getPolicySource: (key: string) => PolicySource;
  /** Fetch the full policy if only the public subset is loaded. */
  refreshIfPartial: () => Promise<void>;
  isSettingLocked: (key: string) => boolean;
  isSettingHidden: (key: string) => boolean;
  isFeatureEnabled: (feature: keyof FeatureGates) => boolean;
  getRestriction: (key: string) => SettingRestriction | undefined;
  getEffectiveDefault: (key: string) => unknown;
  getThemePolicy: () => ThemePolicy;
  /**
   * The theme policy's color mode (#1280): `mode` for users who have not
   * picked one, and for everyone while `locked`. A lock without a valid
   * defaultColorMode pins the built-in default, system.
   */
  getColorModePolicy: () => { mode: ColorMode | null; locked: boolean };
  getForcedThemeId: (availableThemeIds?: string[]) => string | null;
  isThemeDisabled: (themeId: string, isBuiltIn: boolean) => boolean;
  isPluginForceEnabled: (pluginId: string) => boolean;
  isThemeForceEnabled: (themeId: string) => boolean;
}

let policyRequest = 0;

const COLOR_MODES: readonly ColorMode[] = ['light', 'dark', 'system'];

const sameSubject = (a: PolicySubject | null, b: PolicySubject | null) =>
  a === b || (!!a && !!b && a.email === b.email && a.groups.join(',') === b.groups.join(','));

function resolved(rawPolicy: SettingsPolicy, subject: PolicySubject | null) {
  const { policy, matched, sources } = resolvePolicy(rawPolicy, subject);
  return { rawPolicy, policy, matchedScopes: matched, sources };
}

const INITIAL = resolved({ ...DEFAULT_POLICY }, null);

export const usePolicyStore = create<PolicyState>()((set, get) => ({
  ...INITIAL,
  subject: null,
  scopeDomains: null,
  loaded: false,
  partial: false,
  demoFeatureOverrides: {},

  setDemoFeatureOverrides: (overrides) => set({ demoFeatureOverrides: overrides }),

  fetchPolicy: async () => {
    // A fetch started before signing in may answer after the one started
    // after it; only the latest may land.
    const request = ++policyRequest;
    // Static Lite build: an optional policy.json next to index.html stands in
    // for the admin server; missing means defaults, and the gates that need
    // the server stay pinned off either way (lib/lite-config.ts).
    const fallback = IS_LITE ? { policy: applyLitePolicy({}) } : {};
    try {
      // Stalwart serves bundle files immutably: a build-id URL instead of no-store.
      const res = IS_LITE_STALWART
        ? await apiFetch(withLiteBuildId(LITE_POLICY_PATH))
        : await apiFetch(IS_LITE ? LITE_POLICY_PATH : '/api/admin/policy', IS_LITE ? { cache: 'no-store' } : undefined);
      if (request !== policyRequest) return;
      if (res.ok) {
        const data = await res.json();
        if (request !== policyRequest) return;
        const partial = res.headers?.get?.(POLICY_SCOPE_HEADER) === 'public';
        const domainsHeader = res.headers?.get?.(POLICY_DOMAINS_HEADER);
        const scopeDomains = typeof domainsHeader === 'string' ? domainsHeader.split(',').filter(Boolean) : null;
        set({ ...resolved(IS_LITE ? applyLitePolicy(data) : data, get().subject), loaded: true, partial, scopeDomains });
      } else {
        set({ ...(fallback.policy ? resolved(fallback.policy, get().subject) : {}), loaded: true });
      }
    } catch {
      if (request === policyRequest) set({ ...(fallback.policy ? resolved(fallback.policy, get().subject) : {}), loaded: true });
    }
  },

  setPolicySubject: (subject) => {
    if (sameSubject(subject, get().subject)) return;
    set({ ...resolved(get().rawPolicy, subject), subject });
  },

  resolveFor: (subject) => resolvePolicy(get().rawPolicy, subject).policy,

  coversAddress: (email) => {
    const domains = get().scopeDomains;
    if (!domains) return true;
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    return domains.includes(domain);
  },

  getOrganisation: () => get().policy.organisation ?? DEFAULT_ORGANISATION_POLICY,

  getPolicySource: (key) => get().sources[key] ?? 'default',

  refreshIfPartial: async () => {
    if (IS_LITE || (get().loaded && !get().partial)) return;
    await get().fetchPolicy();
  },

  isSettingLocked: (key) => {
    const r = get().policy.restrictions[key];
    return r?.locked === true;
  },

  isSettingHidden: (key) => {
    const r = get().policy.restrictions[key];
    return r?.hidden === true;
  },

  isFeatureEnabled: (feature) => {
    const override = get().demoFeatureOverrides[feature];
    if (override !== undefined) return override;
    return get().policy.features[feature] ?? true;
  },

  getRestriction: (key) => {
    return get().policy.restrictions[key];
  },

  getEffectiveDefault: (key) => {
    return get().policy.defaults[key];
  },

  getThemePolicy: () => {
    return get().policy.themePolicy || { ...DEFAULT_THEME_POLICY };
  },

  getColorModePolicy: () => {
    const tp = get().policy.themePolicy || DEFAULT_THEME_POLICY;
    // policy.json is written by hand: anything but the three modes is no default.
    const mode = COLOR_MODES.find((m) => m === tp.defaultColorMode) ?? null;
    const locked = tp.lockColorMode === true;
    return { mode: locked ? mode ?? 'system' : mode, locked };
  },

  getForcedThemeId: (availableThemeIds) => {
    const forceEnabledThemes = get().policy.forceEnabledThemes || [];
    if (!availableThemeIds || availableThemeIds.length === 0) {
      return forceEnabledThemes[0] || null;
    }

    const available = new Set(availableThemeIds);
    return forceEnabledThemes.find((themeId) => available.has(themeId)) || null;
  },

  isThemeDisabled: (themeId, isBuiltIn) => {
    const tp = get().policy.themePolicy || DEFAULT_THEME_POLICY;
    if (isBuiltIn) {
      return (tp.disabledBuiltinThemes || []).includes(themeId);
    }
    return (tp.disabledThemes || []).includes(themeId);
  },

  isPluginForceEnabled: (pluginId) => {
    return (get().policy.forceEnabledPlugins || []).includes(pluginId);
  },

  isThemeForceEnabled: (themeId) => {
    return (get().policy.forceEnabledThemes || []).includes(themeId);
  },
}));
