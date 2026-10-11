"use client";

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { DateFormat, DateLocale, TimeFormat, FirstDayOfWeek } from '@/stores/settings-store';
import { formatDate } from '@/lib/utils';
import { getEffectiveLocale } from '@/i18n/detect-locale';
import { AUTO_TIME_ZONE, getBrowserTimeZone, getEffectiveTimeZone, listTimeZones } from '@/lib/timezone';
import { SettingsSection, SettingItem, Select, RadioGroup } from './settings-section';

export function LanguageSettings() {
  const t = useTranslations('settings.language_region');
  const tDays = useTranslations('calendar.days');

  const { dateFormat, dateLocale, timeFormat, firstDayOfWeek, timeZone, updateSetting } = useSettingsStore();

  // Browser zone + zone list are read after mount: SSR has no browser, and a
  // server/client mismatch in the option list would trip hydration.
  const [browserTimeZone, setBrowserTimeZone] = useState('UTC');
  const [timeZones, setTimeZones] = useState<string[]>([]);
  useEffect(() => {
    setBrowserTimeZone(getBrowserTimeZone());
    setTimeZones(listTimeZones());
  }, []);

  const timeZoneOptions = useMemo(() => {
    const options = [{ value: AUTO_TIME_ZONE, label: t('time_zone.auto', { zone: browserTimeZone }) }];
    // A zone synced from another browser (newer tz database) may be missing
    // from this runtime's list; keep it selectable rather than snapping the
    // <select> to the first entry.
    const zones = timeZone !== AUTO_TIME_ZONE && !timeZones.includes(timeZone) ? [...timeZones, timeZone].sort() : timeZones;
    for (const zone of zones) options.push({ value: zone, label: zone.replace(/_/g, ' ') });
    return options;
  }, [t, browserTimeZone, timeZones, timeZone]);

  // Subscribe to locale changes so the preview re-renders on language switch
  // (formatDate reads it via getState() and would otherwise stay stale).
  const locale = useLocaleStore((s) => s.locale);

  const preview = useMemo(() => {
    // Build sample timestamps for each bucket so users see what their pick
    // will look like in practice. Use offsets relative to "now" so the
    // bucketing is stable even though the wall-clock keeps moving.
    void locale; void dateFormat; void dateLocale; void timeFormat; void timeZone;
    const now = new Date();
    const today = new Date(now);
    today.setHours(15, 31, 0, 0);
    const thisWeek = new Date(now);
    thisWeek.setDate(now.getDate() - 2);
    thisWeek.setHours(15, 31, 0, 0);
    const older = new Date(now);
    older.setMonth(now.getMonth() - 2);
    older.setHours(15, 31, 0, 0);
    return {
      today: formatDate(today),
      thisWeek: formatDate(thisWeek),
      older: formatDate(older),
    };
  }, [locale, dateFormat, dateLocale, timeFormat, timeZone]);

  // Today's date in the UI language's numeric order, so "Automatic" names
  // the format it resolves to instead of a vague "match language".
  const autoDateExample = useMemo(() => {
    void locale; void timeZone;
    const uiLocale = getEffectiveLocale();
    try {
      return new Date().toLocaleDateString(uiLocale === 'en' ? 'en-US' : uiLocale, {
        timeZone: getEffectiveTimeZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return '';
    }
  }, [locale, timeZone]);

  // Current wall-clock in the effective zone so a pick can be sanity-checked.
  const timeZonePreview = useMemo(() => {
    void timeZone; void timeFormat; void locale;
    try {
      return new Date().toLocaleTimeString(locale && locale !== 'auto' ? locale : undefined, {
        timeZone: getEffectiveTimeZone(),
        hour: '2-digit',
        minute: '2-digit',
        hour12: timeFormat === '12h',
        timeZoneName: 'short',
      });
    } catch {
      return '';
    }
  }, [timeZone, timeFormat, locale]);

  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <SettingItem label={t('language.label')} description={t('language.description')}>
        <LanguageSwitcher />
      </SettingItem>

      <SettingItem label={t('date_format.label')} description={t('date_format.description')}>
        <div className="flex flex-col items-end gap-2">
          <Select
            value={dateFormat}
            onChange={(value) => updateSetting('dateFormat', value as DateFormat)}
            options={[
              { value: 'smart', label: t('date_format.smart') },
              { value: 'relative', label: t('date_format.relative') },
              { value: 'full', label: t('date_format.full') },
            ]}
          />
          <div className="text-xs text-muted-foreground text-end space-y-0.5 font-mono">
            <div>
              <span className="opacity-70">{t('date_format.preview_today')} </span>
              <span className="text-foreground/90">{preview.today}</span>
            </div>
            <div>
              <span className="opacity-70">{t('date_format.preview_this_week')} </span>
              <span className="text-foreground/90">{preview.thisWeek}</span>
            </div>
            <div>
              <span className="opacity-70">{t('date_format.preview_older')} </span>
              <span className="text-foreground/90">{preview.older}</span>
            </div>
          </div>
        </div>
      </SettingItem>

      <SettingItem label={t('date_locale.label')} description={t('date_locale.description')}>
        <Select
          value={dateLocale}
          onChange={(value) => updateSetting('dateLocale', value as DateLocale)}
          options={[
            { value: 'auto', label: t('date_locale.auto', { example: autoDateExample }) },
            { value: 'iso', label: t('date_locale.iso') },
            { value: 'en-GB', label: t('date_locale.dmy') },
            { value: 'en-US', label: t('date_locale.mdy') },
          ]}
        />
      </SettingItem>

      <SettingItem label={t('time_format.label')} description={t('time_format.description')}>
        <RadioGroup
          value={timeFormat}
          onChange={(value) => updateSetting('timeFormat', value as TimeFormat)}
          options={[
            { value: '12h', label: t('time_format.12h') },
            { value: '24h', label: t('time_format.24h') },
          ]}
        />
      </SettingItem>

      <SettingItem label={t('time_zone.label')} description={t('time_zone.description')}>
        <div className="flex flex-col items-end gap-2">
          <Select
            value={timeZone}
            onChange={(value) => updateSetting('timeZone', value)}
            options={timeZoneOptions}
            className="max-w-[16rem]"
          />
          {timeZonePreview && (
            <div className="text-xs text-muted-foreground text-end font-mono">
              <span className="opacity-70">{t('time_zone.preview_now')} </span>
              <span className="text-foreground/90">{timeZonePreview}</span>
            </div>
          )}
        </div>
      </SettingItem>

      <SettingItem label={t('first_day.label')} description={t('first_day.description')}>
        <Select
          value={firstDayOfWeek.toString()}
          onChange={(value) => updateSetting('firstDayOfWeek', parseInt(value) as FirstDayOfWeek)}
          options={[
            { value: '1', label: tDays('monday') },
            { value: '6', label: tDays('saturday') },
            { value: '0', label: tDays('sunday') },
          ]}
        />
      </SettingItem>
    </SettingsSection>
  );
}
