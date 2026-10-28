import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionNav, Select, SettingItem, SettingsSection, ToggleSwitch } from '../settings-section';

// SET-22: on the phone, settings switches (44x24), jump chips (28px) and
// selects (29px) were smaller than the 44px a finger needs (R1).

const HIT = 'pointer-coarse:after:min-h-11';

describe('settings touch targets', () => {
  it('switches keep their size and get a 44px hit area', () => {
    render(<SettingItem label="Sync"><ToggleSwitch checked onChange={() => {}} /></SettingItem>);
    expect(screen.getByRole('switch').className).toContain(HIT);
  });

  it('jump chips get a 44px hit area', () => {
    render(
      <div>
        <SectionNav />
        <SettingsSection id="a" title="One"><span /></SettingsSection>
        <SettingsSection id="b" title="Two"><span /></SettingsSection>
      </div>
    );
    expect(screen.getByRole('button', { name: 'One' }).className).toContain(HIT);
  });

  it('selects are 44px tall on a touch screen', () => {
    render(<Select value="a" onChange={() => {}} ariaLabel="Pick" options={[{ value: 'a', label: 'A' }]} />);
    expect(screen.getByRole('combobox').className).toContain('pointer-coarse:min-h-11');
  });
});
