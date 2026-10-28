'use client';

import { ReactNode, createContext, useContext, useEffect, useId, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { OrgLockedNote } from './org-locked-note';
import { cn } from '@/lib/utils';
import { Button, TOUCH_HIT_AREA } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * The Advanced switch. Rows and sections marked `advanced` render nothing
 * while it is off, but report themselves so the page can say how many it
 * hid. The provider wraps one settings page; without one (tests, plugin
 * previews) advanced rows simply show.
 */
interface AdvancedSettingsContextValue {
  show: boolean;
  register: (id: string, hidden: boolean) => void;
}
const AdvancedSettingsContext = createContext<AdvancedSettingsContextValue | null>(null);

export function AdvancedSettingsProvider({ children }: { children: ReactNode }) {
  const show = useSettingsStore((s) => s.showAdvancedSettings);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const register = useCallback((id: string, isHidden: boolean) => {
    setHidden((prev) => {
      if (prev.has(id) === isHidden) return prev;
      const next = new Set(prev);
      if (isHidden) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ show, register }), [show, register]);
  return (
    <AdvancedSettingsContext.Provider value={value}>
      {children}
      <HiddenAdvancedNotice count={hidden.size} />
    </AdvancedSettingsContext.Provider>
  );
}

/** True when this row or section should render; registers it as hidden otherwise. */
function useAdvancedVisible(advanced: boolean | undefined): boolean {
  const ctx = useContext(AdvancedSettingsContext);
  const id = useId();
  const hidden = Boolean(advanced) && ctx !== null && !ctx.show;
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    register(id, hidden);
    return () => register(id, false);
  }, [register, id, hidden]);
  return !hidden;
}

function HiddenAdvancedNotice({ count }: { count: number }) {
  const t = useTranslations('settings.advanced_switch');
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  if (count === 0) return null;
  return (
    <div
      data-testid="settings-hidden-advanced"
      className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <span>{t('hidden_count', { count })}</span>
      <button
        type="button"
        onClick={() => updateSetting('showAdvancedSettings', true)}
        className="font-medium text-primary hover:underline"
      >
        {t('show')}
      </button>
    </div>
  );
}

/** The sidebar switch that reveals advanced rows and sections everywhere. */
export function AdvancedSettingsSwitch() {
  const t = useTranslations('settings.advanced_switch');
  const show = useSettingsStore((s) => s.showAdvancedSettings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <span id={labelId}>{t('label')}</span>
      <SettingLabelContext.Provider value={labelId}>
        <ToggleSwitch checked={show} onChange={(checked) => updateSetting('showAdvancedSettings', checked)} testId="settings-advanced-switch" />
      </SettingLabelContext.Provider>
    </div>
  );
}

/** Wraps a block that is not a SettingItem but should still hide with Advanced off. */
export function AdvancedOnly({ children }: { children: ReactNode }) {
  const visible = useAdvancedVisible(true);
  return visible ? <>{children}</> : null;
}

const highlightTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Scrolls the section with this id into view, if the open page has it, and
 * flashes the same halo a settings search result gets.
 */
export function scrollToSettingsSection(id: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>(`[data-settings-section="${id.replace(/"/g, '\\"')}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Remove + reflow + add restarts the animation on a second click.
  clearTimeout(highlightTimers.get(el));
  el.classList.remove('settings-search-highlight');
  void el.offsetWidth;
  el.classList.add('settings-search-highlight');
  highlightTimers.set(el, setTimeout(() => {
    el.classList.remove('settings-search-highlight');
    highlightTimers.delete(el);
  }, 1800));
  return true;
}

/**
 * The jump row at the top of a page: one button per section on the page,
 * read from the rendered sections so a page needs nothing beyond giving its
 * SettingsSections an id. Hidden while the page has fewer than two.
 */
export function SectionNav() {
  const ref = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const collect = () => {
      const list = Array.from(host.querySelectorAll<HTMLElement>('[data-settings-section]'))
        // The section's own title, not the heading's text, which also holds
        // the Advanced badge ("Loading & searchAdvanced").
        .map((el) => ({ id: el.dataset.settingsSection ?? '', title: (el.dataset.searchLabel ?? el.querySelector('h3')?.textContent ?? '').trim() }))
        .filter((entry) => entry.id && entry.title);
      setSections((prev) => (
        prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.title === list[i].title) ? prev : list
      ));
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} hidden={sections.length < 2} data-testid="settings-section-nav" className="flex flex-wrap gap-1.5 mb-6">
      {sections.map((section) => (
        <Button
          key={section.id}
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => { if (ref.current?.parentElement) scrollToSettingsSection(section.id, ref.current.parentElement); }}
          className="px-3 text-xs font-normal bg-muted text-foreground"
        >
          {section.title}
        </Button>
      ))}
    </div>
  );
}

/** Small marker next to a label of a row that only shows with Advanced on. */
function AdvancedBadge() {
  const t = useTranslations('settings.advanced_switch');
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-medium">
      {t('badge')}
    </span>
  );
}

/**
 * Lets the controls inside a SettingItem borrow the row's visible label as
 * their accessible name. Without it a bare toggle announces as an unnamed
 * switch, since the row label is a <label> with nothing to point at (#722).
 */
const SettingLabelContext = createContext<string | undefined>(undefined);

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Hidden until the Advanced switch is on. */
  advanced?: boolean;
  /** Anchor for section deep links and the in-page jump row. */
  id?: string;
}

export function SettingsSection({ title, description, children, advanced, id }: SettingsSectionProps) {
  const visible = useAdvancedVisible(advanced);
  if (!visible) return null;
  return (
    <div data-search-label={title} data-settings-section={id} className="space-y-4 scroll-mt-4">
      <div>
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          {title}
          {advanced && <AdvancedBadge />}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

interface SettingItemProps {
  label: string;
  description?: string;
  children: ReactNode;
  locked?: boolean;
  /** Hidden until the Advanced switch is on. */
  advanced?: boolean;
  /** Indented under the row above it, for a sub-option of a toggle. */
  nested?: boolean;
}

export function SettingItem({ label, description, children, locked, advanced, nested }: SettingItemProps) {
  const labelId = useId();
  const visible = useAdvancedVisible(advanced);
  if (!visible) return null;
  return (
    <div
      data-search-label={label}
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 py-3 border-b border-border last:border-0",
        nested && "ms-4 ps-3 border-s-2 border-s-border border-b-transparent py-2",
      )}
    >
      <div className="flex-1 min-w-0 sm:pe-4">
        <div className="flex items-center gap-1.5">
          <label id={labelId} className="text-sm font-medium text-foreground">{label}</label>
          {advanced && <AdvancedBadge />}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {locked && <OrgLockedNote className="mt-1" />}
      </div>
      <SettingLabelContext.Provider value={labelId}>
        {/* The admin's value stays readable; inert keeps mouse and keyboard off it. */}
        <div className={cn("flex-shrink-0", locked && "opacity-60")} inert={locked || undefined}>{children}</div>
      </SettingLabelContext.Provider>
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Overrides the enclosing SettingItem label as the accessible name. */
  ariaLabel?: string;
  /** Test hook (data-testid) for integration tests. */
  testId?: string;
}

export function ToggleSwitch({ checked, onChange, disabled, ariaLabel, testId }: ToggleSwitchProps) {
  const labelledBy = useContext(SettingLabelContext);
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150',
        // 44px to hit on a touch screen, drawn the same size (R1).
        TOUCH_HIT_AREA,
        // Off: an outlined track and a grey knob, 3:1 against the page in
        // both schemes (a light track with a white knob was ~1.1:1). The
        // ring is inset, so the on state keeps its size and look.
        checked ? 'bg-primary' : 'bg-muted ring-1 ring-inset ring-muted-foreground',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full transition-transform duration-150',
          checked ? 'bg-background ltr:translate-x-6 rtl:-translate-x-6' : 'bg-muted-foreground ltr:translate-x-1 rtl:-translate-x-1'
        )}
      />
    </button>
  );
}

interface RadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export function RadioGroup({ value, onChange, options }: RadioGroupProps) {
  const labelledBy = useContext(SettingLabelContext);
  return (
    <div className="flex gap-1.5" role="group" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 text-xs rounded-md transition-colors duration-150',
            value === option.value
              ? 'bg-primary text-primary-foreground font-medium'
              : 'bg-muted hover:bg-accent text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Select({ value, onChange, options, disabled, className, ariaLabel }: SelectProps) {
  const labelledBy = useContext(SettingLabelContext);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : labelledBy}
      dir="auto"
      className={cn(
        "px-3 py-1.5 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors duration-150 pointer-coarse:min-h-11",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-muted-foreground",
        className
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
