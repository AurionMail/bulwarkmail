import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { configManager } from '@/lib/admin/config-manager';
import { logger } from '@/lib/logger';
import { BLANK_TEMPLATES } from '@/lib/wopi/blank-templates';
import type { WopiActions } from '@/lib/wopi/discovery';

/**
 * The formats "New file" offers next to .txt when a WOPI editor is
 * configured (#1393), and the blank file each one starts from.
 *
 * A format is offered when the editor has an "edit" action for it (a
 * view-only one could be created but not filled in) and there is a blank
 * template for it: one shipped in blank-templates.ts, or `new.<ext>` in the
 * admin's `wopiTemplateDir` (ONLYOFFICE's document-templates/new/<locale>
 * folders use that name). `wopiNewFileFormats` replaces the discovery part
 * with the admin's own list.
 */

const EXTENSION = /^[a-z0-9]{1,10}$/;

export interface BlankTemplate {
  type: string;
  data: Uint8Array;
}

async function getTemplateDir(): Promise<string> {
  await configManager.ensureLoaded();
  return configManager.get<string>('wopiTemplateDir', '').trim();
}

/** The admin's format list, lowercased and without dots; empty when unset. */
export function parseFormatList(value: string): string[] {
  const formats = value
    .split(/[\s,;]+/)
    .map((ext) => ext.trim().replace(/^\./, '').toLowerCase())
    .filter((ext) => EXTENSION.test(ext));
  return Array.from(new Set(formats));
}

/** Extensions with a `new.<ext>` file in the template directory. */
async function templateDirFormats(dir: string): Promise<string[]> {
  if (!dir) return [];
  try {
    return (await readdir(dir))
      .map((name) => /^new\.([^.]+)$/.exec(name)?.[1] ?? '')
      .filter((ext) => EXTENSION.test(ext));
  } catch (error) {
    logger.warn('WOPI template directory unreadable', {
      dir,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return [];
  }
}

/** The extensions "New file" offers besides .txt, in a stable order. */
export async function getNewFileFormats(actions: WopiActions): Promise<string[]> {
  await configManager.ensureLoaded();
  const override = parseFormatList(configManager.get<string>('wopiNewFileFormats', ''));
  const available = new Set([...Object.keys(BLANK_TEMPLATES), ...await templateDirFormats(await getTemplateDir())]);
  const wanted = override.length > 0 ? override : Object.keys(actions.edit);
  const formats = wanted.filter((ext) => ext !== 'txt' && available.has(ext));
  // Shipped formats first, in their own order (documents, spreadsheets,
  // presentations, then ODF), then the admin's extras.
  const order = Object.keys(BLANK_TEMPLATES);
  const rank = (ext: string) => (order.includes(ext) ? order.indexOf(ext) : order.length);
  return formats.sort((a, b) => rank(a) - rank(b));
}

/** The blank file a new document of this format starts from, or null. */
export async function getBlankTemplate(ext: string): Promise<BlankTemplate | null> {
  if (!EXTENSION.test(ext)) return null;
  const shipped = BLANK_TEMPLATES[ext];
  const dir = await getTemplateDir();
  if (dir) {
    try {
      const data = await readFile(path.join(dir, `new.${ext}`));
      return { type: shipped?.type ?? 'application/octet-stream', data: new Uint8Array(data) };
    } catch {
      // No admin template for this format: fall back to the shipped one.
    }
  }
  if (!shipped) return null;
  return { type: shipped.type, data: new Uint8Array(Buffer.from(shipped.base64, 'base64')) };
}
