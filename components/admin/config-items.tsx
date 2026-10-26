'use client';

import { useId, type ReactNode } from 'react';
import { RotateCcw } from '@/components/icons';
import { SettingItem, ToggleSwitch } from '@/components/settings/settings-section';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

/**
 * Rows for the server configuration pages (Server, Authentication,
 * Branding). Each shows where the value comes from and offers to drop an
 * admin override; the page keeps the edits and saves them as one.
 */

export type ConfigSource = 'admin' | 'env' | 'default';

export const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground ' +
  'hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

export function SourceBadge({ source, label }: { source?: string; label?: string }) {
  if (!source || source === 'default') return null;
  return (
    <Badge tone={source === 'admin' ? 'accent' : 'muted'} title={source === 'env' ? 'Set in the environment' : 'Set in this panel'}>
      {label ?? source}
    </Badge>
  );
}

export function RevertButton({ onClick, title = 'Revert to default' }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  );
}

interface ConfigItemBase {
  label: string;
  description?: string;
  configKey: string;
  source?: string;
  onChange: (key: string, value: unknown) => void;
  onRevert?: (key: string) => void;
  /** Rows that only matter in unusual setups, hidden behind the Advanced switch. */
  advanced?: boolean;
  disabled?: boolean;
}

interface ConfigTextItemProps extends ConfigItemBase {
  value: string | undefined | null;
  placeholder?: string;
  type?: 'text' | 'url' | 'password' | 'number';
  mono?: boolean;
  /** Wider field, for URLs and lists. */
  wide?: boolean;
}

export function ConfigTextItem({ label, description, configKey, value, source, onChange, onRevert, placeholder, type = 'text', mono, wide, advanced, disabled }: ConfigTextItemProps) {
  const id = useId();
  return (
    <SettingItem label={label} description={description} advanced={advanced}>
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <SourceBadge source={source} />
        <input
          id={id}
          type={type}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(configKey, e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          className={cn(inputClass, 'w-full min-w-0', wide ? 'sm:w-80' : 'sm:w-64', mono && 'font-mono')}
        />
        {source === 'admin' && onRevert && <RevertButton onClick={() => onRevert(configKey)} />}
      </div>
    </SettingItem>
  );
}

interface ConfigToggleItemProps extends ConfigItemBase {
  value: boolean | undefined | null;
}

export function ConfigToggleItem({ label, description, configKey, value, source, onChange, onRevert, advanced, disabled }: ConfigToggleItemProps) {
  return (
    <SettingItem label={label} description={description} advanced={advanced}>
      <div className="flex items-center gap-1.5">
        <SourceBadge source={source} />
        <ToggleSwitch checked={!!value} disabled={disabled} onChange={(checked) => onChange(configKey, checked)} />
        {source === 'admin' && onRevert && <RevertButton onClick={() => onRevert(configKey)} />}
      </div>
    </SettingItem>
  );
}

interface ConfigSelectItemProps extends ConfigItemBase {
  value: string | undefined | null;
  options: ReadonlyArray<string | { value: string; label: string }>;
}

export function ConfigSelectItem({ label, description, configKey, value, source, options, onChange, onRevert, advanced, disabled }: ConfigSelectItemProps) {
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <SettingItem label={label} description={description} advanced={advanced}>
      <div className="flex items-center gap-1.5">
        <SourceBadge source={source} />
        <select
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(configKey, e.target.value)}
          aria-label={label}
          className={cn(inputClass, 'pe-8 cursor-pointer')}
        >
          {normalized.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {source === 'admin' && onRevert && <RevertButton onClick={() => onRevert(configKey)} />}
      </div>
    </SettingItem>
  );
}

/** A note under a group of rows, for a warning or an explanation. */
export function ConfigNote({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md px-3 py-2.5 text-xs leading-relaxed',
        tone === 'warning'
          ? 'border-s-2 border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-300'
          : 'bg-muted/50 text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}
