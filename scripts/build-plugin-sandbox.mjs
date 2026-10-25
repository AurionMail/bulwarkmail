// Builds the plugin sandbox document's script and stylesheet into
// public/plugin-sandbox-assets/, with a manifest.json naming them for
// lib/plugin-sandbox/sandbox-document.ts.
//
// Every plugin iframe loads these. They used to come from a Next page, so
// each frame also loaded, parsed and hydrated Next's client router, and the
// server rendered the page for every frame. Sandboxed frames have opaque
// origins, so the browser's code cache never helps: what a frame loads, it
// parses again, on the host page's main thread.
//
//   node scripts/build-plugin-sandbox.mjs           (npm run build and dev run it)

import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTDIR = path.join(root, 'public', 'plugin-sandbox-assets');

// components/icons imports a few hundred Tabler icons by name, and for any
// other name `import('@tabler/icons-react')` loads all of them. Both went
// through the package's entry module, which also exports the namespace of
// every icon, so all 5000 icons (2.6 MB) ended up in a chunk every frame
// loaded. Like Next's optimizePackageImports, named imports and re-exports
// are pointed at the icons' own files; only the dynamic import gets them all.
const tablerDir = path.join(root, 'node_modules/@tabler/icons-react/dist/esm');
const tablerFiles = new Map();
for (const m of (await readFile(path.join(tablerDir, 'tabler-icons-react.mjs'), 'utf8'))
  .matchAll(/export \{([^}]+)\} from '\.\/icons\/([^']+)';/g)) {
  for (const spec of m[1].split(',')) {
    const name = spec.trim().match(/^default as (\w+)$/)?.[1];
    if (name) tablerFiles.set(name, path.join(tablerDir, 'icons', m[2]).replace(/\\/g, '/'));
  }
}
function splitTablerSpecifiers(keyword, specs, from) {
  return specs.split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
    const [imported, local = imported] = spec.split(/\s+as\s+/);
    const file = tablerFiles.get(imported);
    if (!file) return `${keyword} { ${spec} } from '${from}';`;
    return keyword === 'import'
      ? `import ${local} from '${file}';`
      : `export { default as ${local} } from '${file}';`;
  }).join('\n');
}
const tablerPerIcon = {
  name: 'tabler-per-icon',
  setup(b) {
    b.onResolve({ filter: /^@tabler\/icons-react$/ }, (args) =>
      args.kind === 'dynamic-import' ? { path: 'all-icons', namespace: 'tabler-all' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'tabler-all' }, () => ({
      contents: `export * as icons from '${tablerDir.replace(/\\/g, '/')}/icons/index.mjs';\n`
        + `export * as iconsList from '${tablerDir.replace(/\\/g, '/')}/icons-list.mjs';\n`,
      resolveDir: root,
    }));
    b.onLoad({ filter: /[\\/](components|lib)[\\/].*\.tsx?$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      if (!source.includes('@tabler/icons-react')) return undefined;
      const contents = source.replace(
        /\b(import|export)\s*\{([^}]*)\}\s*from\s*['"]@tabler\/icons-react['"];?/g,
        (_, keyword, specs) => splitTablerSpecifiers(keyword, specs, '@tabler/icons-react'),
      );
      return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
    });
  },
};

/**
 * Build into `outdir` (emptied first). Resolves with the file names and
 * esbuild's metafile outputs.
 */
export async function buildPluginSandbox({ outdir = DEFAULT_OUTDIR } = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  // ES modules so the rarely used parts (every Tabler icon, for an icon name
  // the kit doesn't ship) stay in chunks that load on demand.
  const js = await build({
    entryPoints: { runtime: path.join(root, 'lib/plugin-sandbox/sandbox-entry.ts') },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    minify: true,
    legalComments: 'none',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': root },
    loader: { '.css': 'empty' },
    plugins: [tablerPerIcon],
    metafile: true,
    logLevel: 'warning',
  });
  const script = Object.entries(js.metafile.outputs).find(([, out]) => out.entryPoint)?.[0];
  if (!script) throw new Error('esbuild produced no entry chunk');

  // The UI kit's styles, through the same Tailwind setup as the app's CSS.
  const cssPath = path.join(root, 'app/(sandbox)/plugin-kit.css');
  const css = await postcss([tailwind({ optimize: { minify: true } })]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
  const style = `kit-${createHash('sha256').update(css.css).digest('hex').slice(0, 12)}.css`;
  await writeFile(path.join(outdir, style), css.css);

  // The chunks the script imports statically, so the document can fetch them
  // with it instead of after it has been parsed.
  const outputs = new Map(Object.entries(js.metafile.outputs).map(([f, o]) => [path.basename(f), o]));
  const preload = [];
  const visit = (name) => {
    for (const imp of outputs.get(name)?.imports ?? []) {
      const dep = path.basename(imp.path);
      if (imp.kind !== 'import-statement' || preload.includes(dep)) continue;
      preload.push(dep);
      visit(dep);
    }
  };
  visit(path.basename(script));

  const manifest = { script: path.basename(script), style, preload };
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return { ...manifest, outputs: js.metafile.outputs, css: css.css };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outputs, style, css } = await buildPluginSandbox();
  const sizes = Object.entries(outputs).filter(([f]) => f.endsWith('.js')).map(([f, o]) => `${path.basename(f)} ${o.bytes}`);
  console.log(`[build-plugin-sandbox] ${sizes.join(', ')}, ${style} ${css.length}`);
}
