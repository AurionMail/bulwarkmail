// What a plugin's background frame gets for `require('@plugin-host/ui')`
// and `require('react-dom')`. A background frame draws nothing, yet loading
// the real kit and React DOM made each one parse ~350 kB, a dozen times at
// start-up. Bundles still require them at the top (one bundle serves the
// background and the slots), so the names are all there; using one throws.

import { KIT_NAMES, KIT_VERSION } from './names';

function unavailable(what: string): () => never {
  return () => {
    throw new Error(`${what} only works in a slot frame; the background frame draws nothing`);
  };
}

export const backgroundUiKit: Readonly<Record<string, unknown>> = Object.freeze(Object.fromEntries(
  KIT_NAMES.map((name) => [name, name === 'KIT_VERSION' ? KIT_VERSION : unavailable(`@plugin-host/ui ${name}`)]),
));

export const backgroundReactDom: Readonly<Record<string, unknown>> = new Proxy(Object.freeze({}), {
  // Not a promise or an ES module namespace, for interop helpers that check.
  get: (_target, key) => (typeof key === 'string' && key !== 'then' && key !== '__esModule' ? unavailable(`react-dom ${key}`) : undefined),
});
