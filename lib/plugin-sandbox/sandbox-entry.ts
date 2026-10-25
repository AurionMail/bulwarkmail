// Script of the plugin sandbox document (see sandbox-document.ts), bundled by
// scripts/build-plugin-sandbox.mjs. The document already has the root
// element, so the runtime only has to bind to its host.

import { startSandboxRuntime } from './runtime';

startSandboxRuntime();
