import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doAppGetSettings } from '../host-api-app';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { setCurrentSessionLimits } from '@/lib/session-policy/limits';

/**
 * Plugins read `sessionTimeout` from the settings view. The user setting of
 * that name never did anything; the view reports the idle timeout the
 * organisation set instead.
 */
describe('plugin settings view: sessionTimeout', () => {
  beforeEach(() => {
    useSettingsStore.setState({ sessionTimeout: 45 } as never);
    usePolicyStore.setState({
      rawPolicy: DEFAULT_POLICY,
      policy: {
        ...DEFAULT_POLICY,
        organisation: { ...DEFAULT_ORGANISATION_POLICY, session: { idleMinutes: 20, maxHours: 0, warnSeconds: 60 } },
      },
    });
    setCurrentSessionLimits(null);
  });
  afterEach(() => {
    setCurrentSessionLimits(null);
  });

  it("reports the active account's idle timeout before the guard has looked at every account", () => {
    expect(doAppGetSettings().sessionTimeout).toBe(20);
  });

  it('reports the strictest idle timeout of the signed-in accounts', () => {
    setCurrentSessionLimits({ idle: { minutes: 5, warnSeconds: 60 }, max: null });
    expect(doAppGetSettings().sessionTimeout).toBe(5);
  });

  it('reports 0 when no account has an idle timeout, whatever the old user setting says', () => {
    setCurrentSessionLimits({ idle: null, max: null });
    expect(doAppGetSettings().sessionTimeout).toBe(0);
  });
});
