import { configManager } from './config-manager';

/**
 * Drop a deleted plugin or theme from the policy lists that refer to it by
 * id. Left behind, a later upload that reuses the id would start out forced
 * on for everyone without the admin asking for it.
 */
export async function forgetExtensionInPolicy(kind: 'plugin' | 'theme', id: string): Promise<void> {
  await configManager.ensureLoaded();
  const policy = configManager.getPolicy();
  const key = kind === 'plugin' ? 'forceEnabledPlugins' : 'forceEnabledThemes';
  const list = policy[key] ?? [];
  if (!list.includes(id)) return;
  await configManager.setPolicy({ ...policy, [key]: list.filter((x) => x !== id) });
}
