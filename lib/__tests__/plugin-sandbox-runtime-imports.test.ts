// @vitest-environment node
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { build } from 'esbuild';

// Every plugin iframe parses and runs all the code the sandbox page imports,
// once per frame: sandboxed frames have opaque origins, so the browser's code
// cache never helps. The app's stores came in through the UI kit's Button
// (lib/utils -> settings store -> ten more stores), which made each frame
// boot ~100 ms slower.
describe('plugin sandbox runtime', () => {
  it('does not pull the app stores into plugin frames', async () => {
    const root = path.resolve(__dirname, '../..');
    const result = await build({
      entryPoints: [path.join(root, 'lib/plugin-sandbox/runtime.tsx')],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      alias: { '@': root },
      external: ['@tabler/icons-react'],
      loader: { '.css': 'empty' },
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs).map((f) => f.replace(/\\/g, '/'));
    expect(inputs.filter((f) => /(^|\/)stores\//.test(f))).toEqual([]);
    expect(inputs.filter((f) => /node_modules\/zustand\//.test(f))).toEqual([]);
  }, 30_000);
});
