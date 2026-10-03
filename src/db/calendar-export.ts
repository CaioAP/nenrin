/**
 * Calendar export's bookkeeping: whether it is on, which calendar it owns, and which events
 * it has written there.
 *
 * Every write the export makes to the database goes through here, like every other write —
 * see `people.ts`. The calendar itself is written by `src/export/calendar.ts`; this file only
 * remembers what was written, because on Android the calendar cannot reliably be asked.
 */

import { eq } from 'drizzle-orm';

import type { ExportedEvent } from '@/domain/calendar-export';
import { db } from './client';
import { calendarExport, exportedEvent } from './schema';

const STATE_ID = 1;

export type ExportState = {
  enabled: boolean;
  calendarId: string | null;
};

/** What a fresh install has: export off, no calendar. Also what a missing row means. */
export const EXPORT_OFF: ExportState = { enabled: false, calendarId: null };

export function toExportState(row: { enabled: boolean; calendarId: string | null } | undefined) {
  return row ? { enabled: row.enabled, calendarId: row.calendarId } : EXPORT_OFF;
}

export async function getExportState(): Promise<ExportState> {
  const [row] = await db
    .select()
    .from(calendarExport)
    .where(eq(calendarExport.id, STATE_ID))
    .limit(1);
  return toExportState(row);
}

/** Writes a partial update, creating the row on first use. */
export async function updateExportState(patch: Partial<ExportState>, now = new Date()) {
  const next = { ...(await getExportState()), ...patch, updatedAt: now };

  await db
    .insert(calendarExport)
    .values({ id: STATE_ID, ...next })
    .onConflictDoUpdate({ target: calendarExport.id, set: next });
}

export async function listExportedEvents(): Promise<ExportedEvent[]> {
  return db
    .select({ eventId: exportedEvent.eventId, fingerprint: exportedEvent.fingerprint })
    .from(exportedEvent);
}

/**
 * Called once per event, straight after the calendar accepted it — not batched at the end of
 * a sync. A sync that dies half-way then leaves the record matching the calendar, and the
 * next one picks up where it stopped instead of writing the first half again.
 */
export async function recordExportedEvent(
  eventId: string,
  personId: string,
  fingerprint: string,
): Promise<void> {
  await db
    .insert(exportedEvent)
    .values({ eventId, personId, fingerprint })
    .onConflictDoUpdate({ target: exportedEvent.eventId, set: { personId, fingerprint } });
}

export async function forgetExportedEvent(eventId: string): Promise<void> {
  await db.delete(exportedEvent).where(eq(exportedEvent.eventId, eventId));
}

/** For when the whole calendar is gone, and every event in it with it. */
export async function forgetAllExportedEvents(): Promise<void> {
  await db.delete(exportedEvent);
}
