import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The template picker offers "Manage templates", so making or fixing a
// template doesn't need a trip to Settings in the middle of a message.

vi.mock('../template-manager-modal', () => ({
  TemplateManagerModal: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="manager"><button onClick={onClose}>done</button></div>,
}));

const { TemplatePicker } = await import('../template-picker');

describe('TemplatePicker', () => {
  it('opens the template manager and comes back after it', () => {
    render(<TemplatePicker isOpen onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'manage' }));
    expect(screen.getByRole('dialog', { name: 'manager' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'picker_title' })).toBeNull();
    fireEvent.click(screen.getByText('done'));
    expect(screen.getByRole('dialog', { name: 'picker_title' })).toBeTruthy();
  });
});
