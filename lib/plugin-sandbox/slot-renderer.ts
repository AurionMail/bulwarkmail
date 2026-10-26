// What only slot frames load (runtime.tsx loadRenderer): React DOM and the
// UI kit. Static imports here, one dynamic import of this module there: a
// dynamic import of react-dom/client itself left createRoot off the
// namespace once bundled (CommonJS interop).

import * as ReactDOM from 'react-dom/client';
import { pluginUiKit, SlotPropsContext } from './ui-kit';

export { ReactDOM, pluginUiKit, SlotPropsContext };
