/**
 * Reactive reads for screens.
 *
 * `useLiveQuery` re-runs its query whenever the underlying tables change, which is what makes
 * a write on the add screen show up in the list behind it without any manual refetch. It only
 * works because `client.ts` opens the database with `enableChangeListener: true`.
 *
 * Screens import from here rather than touching `db` or a table directly — same boundary the
 * write repository keeps, for the same reason: v2 needs one place that knows about data
 * access, not thirty.
 */

import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import type { Group } from '@/domain/group';
import type { Person } from '@/domain/person';
import type { AppSettings } from '@/domain/settings';
import { type ExportState, toExportState } from './calendar-export';
import { db } from './client';
import { toGroups, toPeople, toSettings } from './mappers';
import { calendarExport, exportedEvent, group, person, personGroup, settings } from './schema';

/** Everyone, alphabetically, kept live. */
export function usePeople(): { people: Person[]; error: Error | undefined; loading: boolean } {
  const { data, error, updatedAt } = useLiveQuery(
    db.select().from(person).where(isNull(person.deletedAt)).orderBy(asc(person.displayName)),
  );

  const people = useMemo(() => toPeople(data ?? []), [data]);

  // `updatedAt` is undefined until the first result arrives. Distinguishing that from a
  // genuinely empty table is what keeps the empty state from flashing on every launch.
  return { people, error, loading: updatedAt === undefined && error === undefined };
}

/** A single person, kept live. Null once loaded and not found. */
export function usePerson(id: string): {
  person: Person | null;
  error: Error | undefined;
  loading: boolean;
} {
  const { data, error, updatedAt } = useLiveQuery(
    db
      .select()
      .from(person)
      .where(and(eq(person.id, id), isNull(person.deletedAt)))
      .limit(1),
    [id],
  );

  const found = useMemo(() => toPeople(data ?? [])[0] ?? null, [data]);

  return { person: found, error, loading: updatedAt === undefined && error === undefined };
}

/**
 * Every group, alphabetically, each with its current members, kept live.
 *
 * Three live queries rather than one join, because `useLiveQuery` only re-runs for writes to
 * the table a query selects *from* — a join on `person_group` would not notice someone being
 * removed, and would keep counting them. Removed people are dropped here, not in SQL: their
 * memberships survive the soft delete, and a group screen must not list them.
 */
export function useGroups(): { groups: Group[]; error: Error | undefined; loading: boolean } {
  const groups = useLiveQuery(
    db.select().from(group).where(isNull(group.deletedAt)).orderBy(asc(group.name)),
  );
  const memberships = useLiveQuery(db.select().from(personGroup));
  const alive = useLiveQuery(
    db.select({ id: person.id }).from(person).where(isNull(person.deletedAt)),
  );

  const result = useMemo(() => {
    const aliveIds = new Set((alive.data ?? []).map((row) => row.id));
    return toGroups(
      groups.data ?? [],
      (memberships.data ?? []).filter((row) => aliveIds.has(row.personId)),
    );
  }, [groups.data, memberships.data, alive.data]);

  const error = groups.error ?? memberships.error ?? alive.error;
  const loading =
    error === undefined &&
    (groups.updatedAt === undefined ||
      memberships.updatedAt === undefined ||
      alive.updatedAt === undefined);

  return { groups: result, error, loading };
}

/**
 * App settings, kept live.
 *
 * No `loading` flag: an unwritten settings row *is* the defaults, so there is no moment
 * where the answer is unknown. Callers get a usable `AppSettings` on the very first render,
 * which is what lets the reminder window arm without waiting for a round trip.
 */
export function useSettings(): { settings: AppSettings; error: Error | undefined } {
  const { data, error } = useLiveQuery(db.select().from(settings).limit(1));

  return { settings: useMemo(() => toSettings(data?.[0]), [data]), error };
}

/**
 * Calendar export's state and how many events it has written, kept live.
 *
 * Like `useSettings`, no loading flag: an unwritten row *is* "off", so the first render
 * already has a usable answer.
 */
export function useCalendarExport(): { state: ExportState; exportedCount: number } {
  const { data: stateRows } = useLiveQuery(db.select().from(calendarExport).limit(1));
  const { data: countRows } = useLiveQuery(db.select({ total: count() }).from(exportedEvent));

  const state = useMemo(() => toExportState(stateRows?.[0]), [stateRows]);

  return { state, exportedCount: countRows?.[0]?.total ?? 0 };
}
