'use client';

// Host-rendered modal for plugin-requested confirm/alert/prompt dialogs.
// Subscribes to the host-dialog queue and renders the head request, one at
// a time. Closing the modal advances the queue. Prompts collect one or more
// (optionally masked) fields so plugins never fall back to `window.prompt`,
// which the sandbox blocks.

import React, { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { cancelForPlugin, head, resolveDialog, resolveHead, subscribe } from '@/lib/plugin-sandbox/host-dialog';
import { usePluginStore } from '@/stores/plugin-store';
import { Button } from '@/components/ui/button';
import { Puzzle, X } from '@/components/icons';
import { PluginIframeSlot } from './plugin-iframe-slot';
import type { SlotName } from '@/lib/plugin-types';

// Lightweight **bold** support in plugin dialog messages. Everything else is
// rendered literally (newlines come from the parent's white-space: pre-wrap).
// Splitting on the ** delimiter yields alternating plain/bold segments (odd
// indices are bold). Plugins control these strings, so the delimiters balance.
function renderMessage(message?: string): React.ReactNode {
  if (!message) return null;
  return message.split('**').map((seg, i) =>
    i % 2 === 1
      ? <strong key={i}>{seg}</strong>
      : <React.Fragment key={i}>{seg}</React.Fragment>,
  );
}

export function PluginDialogHost(): React.JSX.Element | null {
  const current = useSyncExternalStore(subscribe, head, () => null);
  const t = useTranslations('plugins.dialog');
  const titleId = useId();
  const pluginName = usePluginStore((s) => s.plugins.find((p) => p.id === current?.pluginId)?.name);
  const disablePlugin = usePluginStore((s) => s.disablePlugin);

  const isPrompt = current?.kind === 'prompt';
  const fields = useMemo(() => (isPrompt ? current?.fields ?? [] : []), [isPrompt, current]);
  const hasPassword = fields.some((f) => f.type === 'password');

  // Field values for a prompt, re-initialised whenever a new dialog surfaces.
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!current) return;
    const init: Record<string, string> = {};
    for (const f of current.fields ?? []) init[f.name] = '';
    setValues(init);
  }, [current]);

  // The custom slot's onResult answers its own dialog only; a stray second
  // call after it closed must not resolve the next one in the queue.
  const customProps = useMemo(() => {
    if (current?.kind !== 'custom') return undefined;
    const id = current.id;
    return { ...(current.extraProps ?? {}), onResult: (value: unknown) => resolveDialog(id, value) };
  }, [current]);

  const canSubmit = fields.every((f) => !f.required || (values[f.name] ?? '').length > 0);

  const cancel = () => resolveHead(current?.kind === 'prompt' || current?.kind === 'custom' ? null : false);
  const submitPrompt = () => { if (canSubmit) resolveHead(values); };
  const turnOff = () => {
    if (!current) return;
    const id = current.pluginId;
    cancelForPlugin(id);
    disablePlugin(id);
  };

  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && (current?.kind === 'confirm' || current?.kind === 'alert')) {
        // For prompts, Enter is handled by the form (so it respects required
        // validation and works from within an input); confirm/alert accept.
        // Custom dialogs resolve only via their own onResult callback or the
        // host's X/Escape - an Enter press has no defined meaning for them.
        e.preventDefault();
        resolveHead(true);
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, canSubmit, values]);

  if (!current) return null;

  const name = pluginName ?? current.pluginId;
  const confirmLabel = current.confirmLabel ?? (current.kind === 'alert' ? t('ok') : current.kind === 'prompt' ? t('submit') : t('confirm'));
  const cancelLabel = current.cancelLabel ?? t('cancel');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className="flex w-full flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        style={{
          maxWidth: current.kind === 'custom' ? (current.width ?? 560) : 480,
          maxHeight: '90vh',
        }}
      >
        {/* Who is asking. Plugins choose the title and message, so the host
            names the plugin itself, in a place the plugin can't change. */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground">
          <Puzzle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('from_plugin', { name })}</span>
          {current.kind === 'custom' && (
            <button type="button" onClick={cancel} aria-label={t('close')} className="rounded p-1 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className={current.kind === 'custom' ? 'min-h-0 flex-1 overflow-y-auto p-5' : 'p-5'}>
          <h2 id={titleId} className="mb-2.5 text-base font-semibold">{current.title}</h2>
          {current.message && (
            <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {renderMessage(current.message)}
            </p>
          )}
          {current.kind === 'custom' ? (
            <PluginIframeSlot
              pluginId={current.pluginId}
              slot={(current.slot ?? 'plugin-dialog') as SlotName}
              extraProps={customProps}
            />
          ) : isPrompt ? (
            <form onSubmit={(e) => { e.preventDefault(); submitPrompt(); }}>
              <div className="mb-4 flex flex-col gap-3">
                {fields.map((f, i) => (
                  <label key={f.name} className="flex flex-col gap-1">
                    <span className="text-xs font-medium">{f.label}{f.required ? ' *' : ''}</span>
                    <input
                      type={f.type === 'password' ? 'password' : 'text'}
                      value={values[f.name] ?? ''}
                      placeholder={f.placeholder}
                      autoFocus={i === 0}
                      autoComplete={f.type === 'password' ? 'off' : undefined}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                ))}
                {hasPassword && (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-foreground">{t('password_note', { name })}</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancel}>{cancelLabel}</Button>
                <Button type="submit" disabled={!canSubmit}>{confirmLabel}</Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end gap-2">
              {current.kind === 'confirm' && (
                <Button type="button" variant="outline" autoFocus={!!current.danger} onClick={cancel}>{cancelLabel}</Button>
              )}
              <Button
                type="button"
                variant={current.danger ? 'destructive' : 'default'}
                autoFocus={current.kind === 'alert' || !current.danger}
                onClick={() => resolveHead(true)}
              >
                {confirmLabel}
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-2 text-right">
          <button type="button" onClick={turnOff} className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
            {t('turn_off', { name })}
          </button>
        </div>
      </div>
    </div>
  );
}
