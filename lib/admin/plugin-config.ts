import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { getConfigDir, assertWritable } from './paths';

function getPluginConfigDir(): string {
  return path.join(getConfigDir(), 'plugin-config');
}

function configPath(pluginId: string): string {
  return path.join(getPluginConfigDir(), `${pluginId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Get all config for a plugin.
 */
export async function getPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath(pluginId), 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    logger.warn(`Failed to read plugin config for ${pluginId}`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {};
  }
}

/**
 * Set a single config key for a plugin.
 */
export async function setPluginConfig(pluginId: string, key: string, value: unknown): Promise<void> {
  assertWritable('update plugin config');
  const dir = getPluginConfigDir();
  await ensureDir(dir);

  const config = await getPluginConfig(pluginId);
  config[key] = value;

  const filePath = configPath(pluginId);
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

/** Remove all stored config, secrets included, when a plugin is deleted. */
export async function deletePluginConfig(pluginId: string): Promise<void> {
  assertWritable('delete plugin config');
  try { await unlink(configPath(pluginId)); } catch { /* none stored */ }
}

/**
 * Delete a single config key for a plugin.
 */
export async function deletePluginConfigKey(pluginId: string, key: string): Promise<void> {
  assertWritable('delete plugin config key');
  const config = await getPluginConfig(pluginId);
  delete config[key];

  if (Object.keys(config).length === 0) {
    try { await unlink(configPath(pluginId)); } catch { /* ok if missing */ }
    return;
  }

  const dir = getPluginConfigDir();
  await ensureDir(dir);
  const filePath = configPath(pluginId);
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}
