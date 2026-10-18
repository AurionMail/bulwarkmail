import type { CalendarTask } from '@/lib/jmap/types';
import { demoDate } from '../demo-utils';
import { CAL } from './calendars';

type Progress = 'needs-action' | 'in-process' | 'completed';

function task(id: string, calendar: string, title: string, due: string, extra: { description?: string; progress?: Progress; priority?: number; allDay?: boolean; alert?: boolean; created?: string } = {}): CalendarTask {
  const progress = extra.progress ?? 'needs-action';
  return {
    id,
    calendarIds: { [calendar]: true },
    '@type': 'Task',
    uid: `${id}@meridianlabs.example`,
    title,
    description: extra.description ?? '',
    due,
    start: null,
    duration: null,
    timeZone: null,
    showWithoutTime: extra.allDay ?? true,
    progress,
    progressUpdated: progress === 'needs-action' ? null : demoDate(0, -3),
    priority: extra.priority ?? 0,
    privacy: 'public',
    keywords: null,
    categories: null,
    color: null,
    created: extra.created ?? demoDate(-5),
    updated: demoDate(-1),
    recurrenceRules: null,
    alerts: extra.alert ? {
      'alert-1': { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT1H', relativeTo: 'start' }, action: 'display', acknowledged: null, relatedTo: null },
    } : null,
    relatedTo: null,
  } as CalendarTask;
}

export function createDemoCalendarTasks(): CalendarTask[] {
  return [
    task('demo-task-runbook', CAL.work, 'Rollback runbook: work in Bob\'s comments', demoDate(1, 2), { description: 'Name the dashboard owner in step 3; drop the signing-key question.', progress: 'in-process', priority: 1, allDay: false, alert: true }),
    task('demo-task-rsvp', CAL.work, 'RSVP to the go / no-go review', demoDate(0, 4), { priority: 1, allDay: false }),
    task('demo-task-quote', CAL.work, 'Quote for Rachel\'s launch post', demoDate(3), { description: 'Two sentences. Not "we are excited".', priority: 5 }),
    task('demo-task-canary-list', CAL.work, 'Pick the five canary tenants with Priya', demoDate(4), { description: 'Lumen Logistics is one.' }),
    task('demo-task-slides', CAL.work, 'Finish Infra Summit slides', demoDate(8), { progress: 'in-process', priority: 5, created: demoDate(-12) }),
    task('demo-task-review-pr', CAL.work, 'Review #1284 (signing key overlap)', demoDate(-1), { progress: 'completed', created: demoDate(-3) }),
    task('demo-task-invoice', CAL.work, 'Approve DesignCo invoice 2026-089', demoDate(2), { priority: 9 }),
    task('demo-task-mom', CAL.personal, 'Tell Mom which weekend', demoDate(4), { priority: 5 }),
    task('demo-task-suit', CAL.personal, 'Pick up the suit from the cleaner', demoDate(-2), { priority: 9 }),
    task('demo-task-passport', CAL.personal, 'Check passport is in the travel wallet', demoDate(8), { progress: 'completed' }),
    task('demo-task-snacks', CAL.personal, 'Snacks for book club', demoDate(2)),
  ];
}
