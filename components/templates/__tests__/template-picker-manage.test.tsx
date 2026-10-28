import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTemplateStore } from '@/stores/template-store';
import type { EmailTemplate } from '@/lib/template-types';

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

  // The sections (favorites, recent, each category) are a list: without
  // keys React warned, which the dev build shows as an error overlay.
  it('renders its sections without a React key warning', () => {
    const template = (id: string, category: string, isFavorite = false): EmailTemplate => ({
      id, name: `T ${id}`, subject: '', body: '', category, isFavorite,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', usageCount: 0,
    } as EmailTemplate);
    useTemplateStore.setState({ templates: [template('a', 'Work', true), template('b', 'Work'), template('c', 'Home'), template('d', '')] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TemplatePicker isOpen onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('T c')).toBeTruthy();
    expect(error.mock.calls.some((call) => String(call[0]).includes('unique "key"'))).toBe(false);
    error.mockRestore();
  });
});
