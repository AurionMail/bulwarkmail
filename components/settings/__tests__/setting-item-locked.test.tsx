import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingItem } from '@/components/settings/settings-section';

// A locked setting says why it can't be changed, and the control can't be
// reached by keyboard either (pointer-events alone left Tab and Space working).

function renderItem(locked: boolean) {
  // The setup's next-intl mock returns the key.
  return render(
    <SettingItem label="Density" description="How tight the list is" locked={locked}>
      <button type="button">Compact</button>
    </SettingItem>,
  );
}

describe('SettingItem locked', () => {
  it('shows "Set by your organisation" and makes the control inert', () => {
    renderItem(true);
    expect(screen.getByText('org_locked')).toBeTruthy();
    const control = screen.getByRole('button', { name: 'Compact', hidden: true }).parentElement!;
    expect(control.hasAttribute('inert')).toBe(true);
  });

  it('shows neither when not locked', () => {
    renderItem(false);
    expect(screen.queryByText('org_locked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Compact' }).parentElement!.hasAttribute('inert')).toBe(false);
  });
});
