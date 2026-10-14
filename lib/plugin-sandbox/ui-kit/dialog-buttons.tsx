'use client';

// Buttons for a plugin dialog, drawn by the host in the app's own dialog
// footer (components/plugins/plugin-dialog-host.tsx) rather than inside the
// iframe, so they look and sit like every other dialog's: right-aligned,
// Cancel before the main action, fixed at the bottom while the body scrolls.
//
// The plugin renders <DialogButtons buttons onClick /> anywhere in its
// dialog. It hands the list to the host through the `setDialogButtons`
// prop; the host passes clicks back as the `dialogButtonClick` prop
// ({ id, n }, n counting up). Outside a host dialog the buttons are drawn
// in place.

import * as React from 'react';
import { Button } from './components';

export interface DialogButtonSpec {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
}

/** The slot's props, for kit components that talk to the host. Set by the runtime. */
export const SlotPropsContext = React.createContext<Record<string, unknown>>({});

export function useSlotProps(): Record<string, unknown> {
  return React.useContext(SlotPropsContext);
}

function clean(buttons: DialogButtonSpec[]): DialogButtonSpec[] {
  return buttons.map((b) => ({
    id: String(b.id),
    label: String(b.label),
    ...(b.variant ? { variant: b.variant } : {}),
    ...(b.disabled ? { disabled: true } : {}),
    ...(b.busy ? { busy: true } : {}),
    ...(b.icon ? { icon: String(b.icon) } : {}),
  }));
}

export function DialogButtons({ buttons, onClick }: { buttons: DialogButtonSpec[]; onClick: (id: string) => void }) {
  const props = useSlotProps();
  const setButtons = typeof props.setDialogButtons === 'function'
    ? props.setDialogButtons as (buttons: DialogButtonSpec[]) => void
    : null;
  const onClickRef = React.useRef(onClick);
  onClickRef.current = onClick;

  const list = clean(buttons);
  const key = JSON.stringify(list);
  React.useEffect(() => {
    setButtons?.(JSON.parse(key) as DialogButtonSpec[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setButtons is a new proxy on every props update
  }, [key, !!setButtons]);
  React.useEffect(() => () => { setButtons?.([]); }, [!!setButtons]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = props.dialogButtonClick as { id?: unknown; n?: unknown } | undefined;
  const seen = React.useRef(typeof click?.n === 'number' ? click.n : 0);
  React.useEffect(() => {
    if (!click || typeof click.n !== 'number' || typeof click.id !== 'string') return;
    if (click.n === seen.current) return;
    seen.current = click.n;
    onClickRef.current(click.id);
  }, [click?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (setButtons) return null;
  return (
    <div className="bk flex items-center justify-end gap-2 pt-4">
      {list.map((b) => (
        <Button key={b.id} variant={b.variant ?? 'primary'} disabled={b.disabled} busy={b.busy} icon={b.icon} onClick={() => onClickRef.current(b.id)}>
          {b.label}
        </Button>
      ))}
    </div>
  );
}
