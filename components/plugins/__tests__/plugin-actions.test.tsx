import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PluginActions } from '../plugin-actions';
import { resetActions, setActionDispatcher, setPluginActions } from '@/lib/plugin-sandbox/actions';

const dispatch = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  resetActions();
  dispatch.mockClear();
  setActionDispatcher(dispatch);
});

describe('PluginActions', () => {
  it('renders nothing when no plugin declared actions', () => {
    const { container } = render(<PluginActions surface="message-bulk-actions" context={{ emailIds: ['e1'] }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('draws declared buttons and sends the click with the context', async () => {
    render(<PluginActions surface="message-bulk-actions" context={{ emailIds: ['e1', 'e2'] }} />);
    act(() => setPluginActions('tasks', 'Email to task', 'message-bulk-actions', [{ id: 'make', label: 'Make tasks' }]));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make tasks' })); });

    expect(dispatch).toHaveBeenCalledWith('tasks', 'message-bulk-actions', 'make', { emailIds: ['e1', 'e2'] });
  });

  it('shows only actions meant for the folder or file type', () => {
    act(() => setPluginActions('p', 'P', 'attachment-menu', [
      { id: 'pdf', label: 'Send PDF', mimeTypes: ['application/pdf'] },
      { id: 'img', label: 'Edit image', mimeTypes: ['image/'] },
    ]));

    render(<PluginActions surface="attachment-menu" context={{}} variant="menu" mimeType="image/png" />);

    expect(screen.queryByRole('menuitem', { name: 'Send PDF' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit image' })).toBeInTheDocument();
  });
});
