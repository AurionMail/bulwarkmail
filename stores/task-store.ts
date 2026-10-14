import { create } from 'zustand';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { debug } from '@/lib/debug';
import { taskHooks } from '@/lib/plugin-hooks';
import { taskToView } from '@/lib/plugin-projection';

export type TaskViewFilter = 'all' | 'pending' | 'completed' | 'overdue';

interface TaskStore {
  tasks: CalendarTask[];
  selectedTaskId: string | null;
  filter: TaskViewFilter;
  showCompleted: boolean;
  isLoading: boolean;
  error: string | null;
  setTasks: (tasks: CalendarTask[]) => void;
  setSelectedTaskId: (id: string | null) => void;
  setFilter: (filter: TaskViewFilter) => void;
  setShowCompleted: (show: boolean) => void;
  fetchTasks: (client: IJMAPClient, calendarIds?: string[]) => Promise<void>;
  /** Resolves to null when a plugin stopped the create. */
  createTask: (client: IJMAPClient, task: Partial<CalendarTask>) => Promise<CalendarTask | null>;
  updateTask: (client: IJMAPClient, id: string, updates: Partial<CalendarTask>) => Promise<void>;
  deleteTask: (client: IJMAPClient, id: string) => Promise<void>;
  toggleTaskComplete: (client: IJMAPClient, task: CalendarTask) => Promise<void>;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  filter: 'all',
  showCompleted: false,
  isLoading: false,
  error: null,
  setTasks: (tasks) => set({ tasks }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setFilter: (filter) => {
    if (get().filter === filter) return;
    set({ filter });
    void taskHooks.onTaskFilterChange.emit({ filter, showCompleted: get().showCompleted });
  },
  setShowCompleted: (show) => {
    if (get().showCompleted === show) return;
    set({ showCompleted: show });
    void taskHooks.onTaskFilterChange.emit({ filter: get().filter, showCompleted: show });
  },

  fetchTasks: async (client, calendarIds) => {
    debug.log('tasks', 'TaskStore/fetchTasks start', { calendarIds: calendarIds || 'all' });
    set({ isLoading: true, error: null });
    try {
      const tasks = await client.getCalendarTasks(calendarIds);
      debug.log('tasks', 'TaskStore/fetchTasks received', tasks.length, 'tasks');
      tasks.forEach((t, i) => {
        debug.log('tasks', `TaskStore/fetchTasks [${i}]`, {
          id: t.id, uid: t.uid, '@type': t['@type'],
          title: t.title, due: t.due, progress: t.progress,
          showWithoutTime: t.showWithoutTime, calendarIds: t.calendarIds,
        });
      });
      set({ tasks, isLoading: false });
      if (taskHooks.onTasksLoaded.size > 0) void taskHooks.onTasksLoaded.emit(tasks.map(taskToView));
    } catch (error) {
      debug.error('TaskStore/fetchTasks failed', error);
      set({ isLoading: false, error: 'Failed to fetch tasks' });
    }
  },

  createTask: async (client, task) => {
    debug.log('tasks', 'TaskStore/createTask', task);
    if (!(await taskHooks.onBeforeTaskCreate.intercept(taskToView({ id: '', ...task } as CalendarTask)))) return null;
    const created = await client.createCalendarTask(task);
    debug.log('tasks', 'TaskStore/createTask result', { id: created.id, uid: created.uid, title: created.title });
    set({ tasks: [...get().tasks, created] });
    void taskHooks.onTaskCreate.emit(taskToView(created));
    return created;
  },

  updateTask: async (client, id, updates) => {
    if (!(await taskHooks.onBeforeTaskUpdate.intercept({ taskId: id, patch: updates }))) return;
    const before = get().tasks.find(t => t.id === id);
    const newId = await client.updateCalendarTask(id, updates);
    if (newId && newId !== id) {
      // Moved into a calendar of another account: the server recreated it
      // under a new id, so reload rather than patch the old entry. (#1204)
      set({ selectedTaskId: get().selectedTaskId === id ? newId : get().selectedTaskId });
      await get().fetchTasks(client);
      const moved = get().tasks.find(t => t.id === newId)
        ?? ({ ...before, ...updates, id: newId } as CalendarTask);
      void taskHooks.onTaskUpdate.emit(taskToView(moved));
      return;
    }
    const updated = { ...(before ?? { id }), ...updates, updated: new Date().toISOString() } as CalendarTask;
    set({
      tasks: get().tasks.map(t => t.id === id ? updated : t),
    });
    void taskHooks.onTaskUpdate.emit(taskToView(updated));
  },

  deleteTask: async (client, id) => {
    const title = get().tasks.find(t => t.id === id)?.title || '';
    if (!(await taskHooks.onBeforeTaskDelete.intercept({ taskId: id, title }))) return;
    await client.deleteCalendarTask(id);
    set({
      tasks: get().tasks.filter(t => t.id !== id),
      selectedTaskId: get().selectedTaskId === id ? null : get().selectedTaskId,
    });
    void taskHooks.onTaskDelete.emit({ taskId: id, title });
  },

  toggleTaskComplete: async (client, task) => {
    const newProgress = task.progress === 'completed' ? 'needs-action' : 'completed';
    const updates: Partial<CalendarTask> = {
      progress: newProgress,
    };
    await client.updateCalendarTask(task.id, updates);
    set({
      tasks: get().tasks.map(t => t.id === task.id ? { ...t, ...updates, updated: new Date().toISOString() } : t),
    });
    // A toggle is reported as onTaskToggleComplete only, not also as
    // onTaskUpdate, so a plugin that listens to both sees each change once.
    void taskHooks.onTaskToggleComplete.emit({ taskId: task.id, complete: newProgress === 'completed' });
  },

  clearTasks: () => set({ tasks: [], selectedTaskId: null, error: null }),
}));
