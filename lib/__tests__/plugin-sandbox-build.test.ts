// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPluginSandbox } from '../../scripts/build-plugin-sandbox.mjs';

type Outputs = Record<string, { bytes: number; entryPoint?: string; inputs: Record<string, unknown>; imports: Array<{ path: string; kind: string }> }>;

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

// Every plugin frame parses what its document loads up front, again in every
// frame (opaque origins get no code cache).
describe('plugin sandbox build', () => {
  it('loads React, the runtime and the kit up front, and every other icon only on demand', async () => {
    const outdir = await mkdtemp(path.join(tmpdir(), 'plugin-sandbox-'));
    dirs.push(outdir);
    const { script, style, outputs } = await buildPluginSandbox({ outdir }) as { script: string; style: string; outputs: Outputs };

    const byName = new Map(Object.entries(outputs).map(([file, out]) => [path.basename(file), out]));
    const eager = new Set<string>();
    const walk = (name: string) => {
      if (eager.has(name)) return;
      eager.add(name);
      for (const imp of byName.get(name)!.imports) if (imp.kind === 'import-statement') walk(path.basename(imp.path));
    };
    walk(script);
    const eagerBytes = [...eager].reduce((sum, n) => sum + byName.get(n)!.bytes, 0);
    const eagerInputs = [...eager].flatMap((n) => Object.keys(byName.get(n)!.inputs)).map((f) => f.replace(/\\/g, '/'));

    // Background frames: the runtime and React, no React DOM or kit. (The
    // first build put all 5000 Tabler icons, 2.6 MB, in an eager chunk.)
    expect(eagerBytes).toBeLessThan(100_000);
    expect(eagerInputs.filter((f) => f.includes('node_modules/react-dom/') || f.includes('ui-kit/components'))).toEqual([]);
    expect(eagerInputs.filter((f) => f.includes('node_modules/next/'))).toEqual([]);
    expect(eagerInputs.filter((f) => /(^|\/)stores\//.test(f))).toEqual([]);
    // ...but they are still there for an icon name the kit doesn't ship.
    const lazy = [...byName.keys()].filter((n) => n.endsWith('.js') && !eager.has(n));
    expect(lazy.some((n) => byName.get(n)!.bytes > 1_000_000)).toBe(true);

    const manifest = JSON.parse(await readFile(path.join(outdir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ script, style, preload: [...eager].filter((n) => n !== script) });
    // Slot frames preload React DOM and the kit, but not every icon.
    const slotInputs = (manifest.slotPreload as string[]).flatMap((n) => Object.keys(byName.get(n)!.inputs)).map((f) => f.replace(/\\/g, '/'));
    expect(slotInputs.some((f) => f.includes('node_modules/react-dom/'))).toBe(true);
    expect(slotInputs.some((f) => f.includes('ui-kit/components'))).toBe(true);
    expect((manifest.slotPreload as string[]).every((n) => byName.get(n)!.bytes < 1_000_000)).toBe(true);
    expect(await readFile(path.join(outdir, style), 'utf8')).toContain('.bk');

    // What a slot frame imports on demand, as the browser will get it: Vitest's
    // own module interop once hid a createRoot that the bundle had lost.
    const rendererChunk = byName.get(script)!.imports.find((i) => i.kind === 'dynamic-import')!;
    const renderer = await import(/* @vite-ignore */ pathToFileURL(path.join(outdir, path.basename(rendererChunk.path))).href);
    expect(typeof renderer.ReactDOM.createRoot).toBe('function');
    expect(typeof renderer.pluginUiKit.Button).toBe('object');
    expect(renderer.SlotPropsContext).toBeDefined();
  }, 120_000);
});
