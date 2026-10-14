import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTaskStore } from '../task-store';
import { clearAllHooks, taskHooks } from '@/lib/plugin-hooks';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Plugins hear about loaded, created, changed, deleted and checked-off tasks
// and filter changes; the before-hooks run ahead of the server call and can
// stop the change.

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 't1',
    calendarIds: { 'cal-1': true },
    '@type': 'Task',
    uid: 'task-uid-1',
    title: 'Write report',
    description: '',
    due: '2026-09-08T10:00:00',
    progress: 'needs-action',
    priority: 0,
    keywords: null,
    ...overrides,
  } as CalendarTask;
}

let client: IJMAPClient;

beforeEach(() => {
  clearAllHooks();
  useTaskStore.setState({ tasks: [], selectedTaskId: null, filter: 'all', showCompleted: false, isLoading: false, error: null });
  client = {
    getCalendarTasks: vi.fn().mockResolvedValue([makeTask()]),
    createCalendarTask: vi.fn(async (t: Partial<CalendarTask>) => makeTask({ ...t, id: 'created' })),
    updateCalendarTask: vi.fn().mockResolvedValue(undefined),
    deleteCalendarTask: vi.fn().mockResolvedValue(undefined),
  } as never;
});

describe('onTasksLoaded', () => {
  it('reports the fetched tasks as views', async () => {
    const handler = vi.fn();
    taskHooks.onTasksLoaded.register('t', handler);
    await useTaskStore.getState().fetchTasks(client);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 't1', title: 'Write report', isComplete: false, calendarId: 'cal-1' }),
    ]);
  });

  it('stays quiet when loading failed', async () => {
    vi.mocked(client.getCalendarTasks).mockRejectedValue(new Error('boom'));
    const handler = vi.fn();
    taskHooks.onTasksLoaded.register('t', handler);
    await useTaskStore.getState().fetchTasks(client);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('create, update and delete', () => {
  it('asks before creating and reports the created task', async () => {
    const before = vi.fn((view) => {
      expect(client.createCalendarTask).not.toHaveBeenCalled();
      expect(view).toMatchObject({ title: 'New task' });
      return true;
    });
    taskHooks.onBeforeTaskCreate.register('t', before);
    const after = vi.fn();
    taskHooks.onTaskCreate.register('t', after);

    await useTaskStore.getState().createTask(client, { title: 'New task', calendarIds: { 'cal-1': true } });

    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0][0]).toMatchObject({ id: 'created', title: 'New task' });
  });

  it('creates nothing when a plugin says no', async () => {
    taskHooks.onBeforeTaskCreate.register('t', () => false);
    const after = vi.fn();
    taskHooks.onTaskCreate.register('t', after);

    const created = await useTaskStore.getState().createTask(client, { title: 'New task' });

    expect(created).toBeNull();
    expect(client.createCalendarTask).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('asks before changing and reports the changed task', async () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    const before = vi.fn(() => {
      expect(client.updateCalendarTask).not.toHaveBeenCalled();
      return true;
    });
    taskHooks.onBeforeTaskUpdate.register('t', before);
    const after = vi.fn();
    taskHooks.onTaskUpdate.register('t', after);

    await useTaskStore.getState().updateTask(client, 't1', { title: 'Renamed' });

    expect(before).toHaveBeenCalledWith({ taskId: 't1', patch: { title: 'Renamed' } });
    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0][0]).toMatchObject({ id: 't1', title: 'Renamed' });
  });

  it('leaves the task alone when a plugin says no', async () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    taskHooks.onBeforeTaskUpdate.register('t', () => false);
    const after = vi.fn();
    taskHooks.onTaskUpdate.register('t', after);

    await useTaskStore.getState().updateTask(client, 't1', { title: 'Renamed' });

    expect(client.updateCalendarTask).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].title).toBe('Write report');
    expect(after).not.toHaveBeenCalled();
  });

  it('does not report a change the server refused', async () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    vi.mocked(client.updateCalendarTask).mockRejectedValue(new Error('boom'));
    const after = vi.fn();
    taskHooks.onTaskUpdate.register('t', after);
    await expect(useTaskStore.getState().updateTask(client, 't1', { title: 'X' })).rejects.toThrow('boom');
    expect(after).not.toHaveBeenCalled();
  });

  it('asks before deleting and reports the deleted task with its title', async () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    const before = vi.fn(() => {
      expect(client.deleteCalendarTask).not.toHaveBeenCalled();
      return true;
    });
    taskHooks.onBeforeTaskDelete.register('t', before);
    const after = vi.fn();
    taskHooks.onTaskDelete.register('t', after);

    await useTaskStore.getState().deleteTask(client, 't1');

    expect(before).toHaveBeenCalledWith({ taskId: 't1', title: 'Write report' });
    expect(after).toHaveBeenCalledWith({ taskId: 't1', title: 'Write report' });
  });

  it('keeps the task when a plugin says no, and reports no failed delete', async () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    taskHooks.onBeforeTaskDelete.register('t', () => false);
    const after = vi.fn();
    taskHooks.onTaskDelete.register('t', after);

    await useTaskStore.getState().deleteTask(client, 't1');
    expect(client.deleteCalendarTask).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toHaveLength(1);

    clearAllHooks();
    taskHooks.onTaskDelete.register('t', after);
    vi.mocked(client.deleteCalendarTask).mockRejectedValue(new Error('boom'));
    await expect(useTaskStore.getState().deleteTask(client, 't1')).rejects.toThrow('boom');
    expect(after).not.toHaveBeenCalled();
  });
});

describe('onTaskToggleComplete', () => {
  it('reports the new state after the server took it, and not as an update', async () => {
    const task = makeTask();
    useTaskStore.setState({ tasks: [task] });
    const toggled = vi.fn((_payload: unknown) => {
      expect(client.updateCalendarTask).toHaveBeenCalled();
    });
    taskHooks.onTaskToggleComplete.register('t', toggled);
    const updated = vi.fn();
    taskHooks.onTaskUpdate.register('t', updated);

    await useTaskStore.getState().toggleTaskComplete(client, task);
    await useTaskStore.getState().toggleTaskComplete(client, { ...task, progress: 'completed' });

    expect(toggled.mock.calls.map((c) => c[0])).toEqual([
      { taskId: 't1', complete: true },
      { taskId: 't1', complete: false },
    ]);
    expect(updated).not.toHaveBeenCalled();
  });

  it('stays quiet when the server refused', async () => {
    const task = makeTask();
    vi.mocked(client.updateCalendarTask).mockRejectedValue(new Error('boom'));
    const toggled = vi.fn();
    taskHooks.onTaskToggleComplete.register('t', toggled);
    await expect(useTaskStore.getState().toggleTaskComplete(client, task)).rejects.toThrow('boom');
    expect(toggled).not.toHaveBeenCalled();
  });
});

describe('onTaskFilterChange', () => {
  it('reports filter and show-completed changes, but not unchanged values', () => {
    const handler = vi.fn();
    taskHooks.onTaskFilterChange.register('t', handler);
    useTaskStore.getState().setFilter('all');
    useTaskStore.getState().setShowCompleted(false);
    expect(handler).not.toHaveBeenCalled();

    useTaskStore.getState().setFilter('overdue');
    useTaskStore.getState().setShowCompleted(true);
    expect(handler.mock.calls.map((c) => c[0])).toEqual([
      { filter: 'overdue', showCompleted: false },
      { filter: 'overdue', showCompleted: true },
    ]);
  });
});
