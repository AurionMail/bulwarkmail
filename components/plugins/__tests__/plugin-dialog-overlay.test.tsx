import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../plugin-iframe-slot', () => ({ PluginIframeSlot: () => <div data-testid="custom-frame" /> }));

import { PluginDialogHost } from '../plugin-dialog-host';
import { awaitCustomDialog, awaitDialog, head, resetDialogLimits, resolveHead } from '@/lib/plugin-sandbox/host-dialog';

beforeEach(() => {
  while (head()) resolveHead(null);
  resetDialogLimits();
});

describe('a question on top of a plugin dialog', () => {
  it('shows both, answers the question, and keeps the plugin dialog open', async () => {
    render(<PluginDialogHost />);
    let custom: Promise<unknown>;
    let question: Promise<boolean>;
    act(() => { custom = awaitCustomDialog({ pluginId: 'ai', title: 'Assistant', message: '', slot: 'plugin-dialog' }); });
    act(() => { question = awaitDialog({ pluginId: 'ai', kind: 'confirm', title: 'Discard the text?', message: '' }); });

    expect(screen.getByTestId('custom-frame')).toBeInTheDocument();
    expect(screen.getByText('Discard the text?')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'confirm' })); });

    await expect(question!).resolves.toBe(true);
    expect(screen.queryByText('Discard the text?')).toBeNull();
    expect(screen.getByTestId('custom-frame')).toBeInTheDocument();
    act(() => resolveHead(null));
    await expect(custom!).resolves.toBeNull();
  });
});
