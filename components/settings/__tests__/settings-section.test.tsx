import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SettingItem, ToggleSwitch, RadioGroup, Select } from '../settings-section';

describe('SettingItem controls', () => {
  it('names a toggle after the row label and reports its state', () => {
    render(
      <SettingItem label="Conversation view">
        <ToggleSwitch checked onChange={() => {}} />
      </SettingItem>
    );

    const toggle = screen.getByRole('switch', { name: 'Conversation view' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('lets an explicit ariaLabel win over the row label', () => {
    render(
      <SettingItem label="Conversation view">
        <ToggleSwitch checked={false} onChange={() => {}} ariaLabel="Group by thread" />
      </SettingItem>
    );

    expect(screen.getByRole('switch', { name: 'Group by thread' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports which option of a segmented control is active', () => {
    render(
      <SettingItem label="Density">
        <RadioGroup
          value="cosy"
          onChange={() => {}}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'cosy', label: 'Cosy' },
          ]}
        />
      </SettingItem>
    );

    expect(screen.getByRole('button', { name: 'Cosy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Density' })).toBeTruthy();
  });

  it('names a select after the row label', () => {
    render(
      <SettingItem label="Time format">
        <Select value="24h" onChange={() => {}} options={[{ value: '24h', label: '24 hour' }]} />
      </SettingItem>
    );

    expect(screen.getByRole('combobox', { name: 'Time format' })).toBeTruthy();
  });

  it('works standalone, outside a SettingItem', () => {
    render(<ToggleSwitch checked onChange={() => {}} ariaLabel="Standalone" />);

    expect(screen.getByRole('switch', { name: 'Standalone' })).toBeTruthy();
  });
});

describe('ToggleSwitch off state (finding 56)', () => {
  // The token of the off track's outline and knob, per scheme, against the page.
  function token(block: string, name: string): string {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const start = css.indexOf(block);
    const end = css.indexOf('}', start);
    const match = new RegExp(`${name}:[ \\t]*(#[0-9a-f]{6})`, 'i').exec(css.slice(start, end));
    if (!match) throw new Error(`${name} not found in ${block}`);
    return match[1];
  }
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it('outlines the off track and greys its knob; the on state is unchanged', () => {
    const { rerender } = render(<ToggleSwitch checked={false} onChange={() => {}} ariaLabel="Off" />);
    const off = screen.getByRole('switch');
    expect(off).toHaveClass('ring-1', 'ring-inset', 'ring-muted-foreground');
    expect(off.firstElementChild).toHaveClass('bg-muted-foreground');
    rerender(<ToggleSwitch checked onChange={() => {}} ariaLabel="On" />);
    const on = screen.getByRole('switch');
    expect(on).toHaveClass('bg-primary');
    expect(on).not.toHaveClass('ring-1');
    expect(on.firstElementChild).toHaveClass('bg-background');
  });

  it('reaches 3:1 against the page in light and dark', () => {
    for (const block of [':root {', '.dark {']) {
      const ratio = contrast(token(block, '--color-muted-foreground'), token(block, '--color-background'));
      expect(ratio, block).toBeGreaterThanOrEqual(3);
    }
  });
});
