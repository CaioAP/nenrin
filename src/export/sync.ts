/**
 * Keeps Nenrin's calendar in step with the database.
 *
 * Like the notification window, the calendar is derived state: there is no "export now"
 * button once export is on. Anything that changes who should be in it — adding, editing or
 * deleting a person, changing the leap-day policy, or a new year sliding the 29 February
 * events forward — re-runs `syncCalendarExport` from `use-calendar-export.ts`.
 */

import {
  forgetAllExportedEvents,
  forgetExportedEvent,
  getExportState,
  listExportedEvents,
  recordExportedEvent,
  updateExportState,
} from '@/db/calendar-export';
import { listPeople } from '@/db/people';
import { getSettings } from '@/db/settings';
import { exportEventsFor, fingerprintOf, planExportSync } from '@/domain/calendar-export';
import {
  calendarExists,
  createExportCalendar,
  createExportEvent,
  deleteExportCalendar,
  deleteExportEvent,
  hasExportAccess,
  requestExportAccess,
} from './calendar';

export type SyncOutcome =
  /** Export is switched off; nothing was touched. */
  | { kind: 'off' }
  /** Export is on but calendar access is not granted, so nothing can be written. */
  | { kind: 'denied' }
  /** The user deleted Nenrin's calendar outside the app, which switched export off. */
  | { kind: 'calendar-removed' }
  | { kind: 'synced'; events: number };

/**
 * One sync at a time. A write and a foreground can both trigger one within milliseconds, and
 * two interleaved runs would each plan against the same record and create every new event
 * twice.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Brings the calendar in line with the database. A no-op while export is off. */
export function syncCalendarExport(): Promise<SyncOutcome> {
  return serialize(syncNow);
}

async function syncNow(): Promise<SyncOutcome> {
  const state = await getExportState();
  if (!state.enabled) return { kind: 'off' };

  // Checked, never requested. This runs unprompted on every foreground, and a permission
  // dialog out of nowhere is the version people decline.
  if (!(await hasExportAccess())) return { kind: 'denied' };

  let calendarId = state.calendarId;

  // A calendar the app created and can no longer find was deleted by the user, in their
  // calendar app — not hidden, because `calendarExists` sees hidden calendars too. Taken as
  // "stop": recreating it would undo something they did on purpose, on every foreground.
  if (calendarId !== null && !(await calendarExists(calendarId))) {
    await forgetAllExportedEvents();
    await updateExportState({ enabled: false, calendarId: null });
    return { kind: 'calendar-removed' };
  }

  if (calendarId === null) {
    calendarId = await createExportCalendar();
    // Whatever the record held belonged to a calendar that no longer exists.
    await forgetAllExportedEvents();
    await updateExportState({ calendarId });
  }

  const [people, settings, existing] = await Promise.all([
    listPeople(),
    getSettings(),
    listExportedEvents(),
  ]);
  const desired = exportEventsFor(people, { today: new Date(), policy: settings.leapDayPolicy });
  const plan = planExportSync(desired, existing);

  // Removals first, so a birthday moved from one day to another is never on both at once.
  for (const eventId of plan.remove) {
    await deleteExportEvent(eventId);
    await forgetExportedEvent(eventId);
  }
  for (const event of plan.create) {
    const eventId = await createExportEvent(calendarId, event);
    await recordExportedEvent(eventId, event.personId, fingerprintOf(event));
  }

  return { kind: 'synced', events: desired.length };
}

/**
 * Switches export on and runs the first sync, so the person who tapped sees it work or fail.
 *
 * Requests access, unlike a background sync: this only runs because someone tapped a button
 * asking for exactly this.
 */
export function enableCalendarExport(): Promise<SyncOutcome> {
  return serialize(async () => {
    if (!(await requestExportAccess())) return { kind: 'denied' } as const;
    await updateExportState({ enabled: true });
    return syncNow();
  });
}

/**
 * Switches export off and takes every birthday Nenrin added back out of the calendar.
 *
 * Deleting the calendar rather than each event: it is Nenrin's own, so it holds nothing
 * else, and one call cannot leave half the birthdays behind.
 */
export function disableCalendarExport(): Promise<void> {
  return serialize(async () => {
    const { calendarId } = await getExportState();
    if (calendarId !== null) await deleteExportCalendar(calendarId);
    await forgetAllExportedEvents();
    await updateExportState({ enabled: false, calendarId: null });
  });
}
