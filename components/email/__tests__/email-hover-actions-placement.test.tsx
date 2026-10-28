import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import { useSettingsStore } from '@/stores/settings-store';
import { EmailHoverActions } from '../email-hover-actions';

vi.mock('@/components/plugins/plugin-actions', () => ({
  PluginActions: () => null,
  usePluginActions: () => [],
  useMessageActionTarget: () => ({ accountKind: 'personal', keywords: [] }),
}));

// Gmail keeps a row's actions on its first line when attachment chips make the
// row taller; ours sat centred between the subject and the chips.

const email = { id: 'e1', keywords: { $seen: true }, mailboxIds: { inbox: true } } as unknown as Email;

function toolbar(pinToFirstLine?: boolean) {
  render(<EmailHoverActions email={email} onDelete={vi.fn()} pinToFirstLine={pinToFirstLine} />);
  return screen.getByTestId('hover-action-delete').closest('.absolute') as HTMLElement;
}

beforeEach(() => {
  useSettingsStore.setState({ hoverActions: ['delete'], interfaceLayout: 'mountain-view', hoverActionsMode: 'inline' } as never);
});

describe('row quick action placement', () => {
  it('stays on the first line of a Mountain View row', () => {
    const el = toolbar(true);
    expect(el.className).toContain('h-10');
    expect(el.className).not.toContain('bottom-0');
  });

  it('spans the whole row otherwise', () => {
    const el = toolbar();
    expect(el.className).toContain('bottom-0');
    expect(el.className).not.toContain('h-10');
  });
});
