// `@plugin-host/ui`: the module plugins require for the app's controls.
// See components.tsx. Adding an export is a plugin API change: list it in
// KIT_EXPORTS below (the plugins repo's docs and fake API read that list)
// and in names.ts.

import * as components from './components';
import { DialogButtons, useSlotProps } from './dialog-buttons';
import { KIT_VERSION } from './names';

export * from './components';
export { DialogButtons, SlotPropsContext, useSlotProps } from './dialog-buttons';
export type { DialogButtonSpec } from './dialog-buttons';

export { KIT_VERSION };

export const pluginUiKit = Object.freeze({
  ...components,
  DialogButtons,
  useSlotProps,
  KIT_VERSION,
});

export const KIT_EXPORTS = Object.freeze(Object.keys(pluginUiKit).sort());
