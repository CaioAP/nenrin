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

import { and, asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import type { Person } from '@/domain/person';
import { db } from './client';
import { toPeople } from './mappers';
import { person } from './schema';

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
