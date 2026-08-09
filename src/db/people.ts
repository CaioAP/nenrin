/**
 * The person repository. Every read and write of a person goes through here.
 *
 * No screen touches `db` or a table directly. That is not tidiness for its own sake: the v2
 * opt-in account backs up automatically on every change, and this is the single place that
 * will enqueue those changes. Thirty scattered `db.update(...)` calls would make that
 * impossible to add without auditing the whole app.
 *
 * Deletes are soft. A hard delete is invisible to a later sync, so restoring a backup would
 * resurrect people the user removed — every read here filters `deletedAt IS NULL`.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import { makePartialDate } from '@/domain/birthday';
import { type Person, resolveLeadDays } from '@/domain/person';
import type { Schedulable } from '@/domain/schedule';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import { db } from './client';
import {
  type NewPerson,
  type PersonPatch,
  toNewPersonRow,
  toPerson,
  toPersonUpdate,
} from './mappers';
import { group, person, personGroup } from './schema';

const alive = isNull(person.deletedAt);

/** Everyone, alphabetically. The People tab. */
export async function listPeople(): Promise<Person[]> {
  const rows = await db.select().from(person).where(alive).orderBy(asc(person.displayName));
  return rows.map(toPerson);
}

export async function getPerson(id: string): Promise<Person | null> {
  const rows = await db
    .select()
    .from(person)
    .where(and(eq(person.id, id), alive))
    .limit(1);
  return rows[0] ? toPerson(rows[0]) : null;
}

/** Adds a person and returns them as stored, so callers never guess at the generated id. */
export async function createPerson(input: NewPerson, now = new Date()): Promise<Person> {
  const row = toNewPersonRow(input, randomUUID(), now);
  const [created] = await db.insert(person).values(row).returning();
  return toPerson(created);
}

/**
 * Applies a patch. Returns null if the person is gone.
 *
 * Only keys present in the patch are written — see `toPersonUpdate`, which is what lets
 * `{ notes: null }` clear a note while omitting `notes` leaves it untouched.
 */
export async function updatePerson(
  id: string,
  patch: PersonPatch,
  now = new Date(),
): Promise<Person | null> {
  const [updated] = await db
    .update(person)
    .set(toPersonUpdate(patch, now))
    .where(and(eq(person.id, id), alive))
    .returning();
  return updated ? toPerson(updated) : null;
}

/**
 * Soft-deletes a person. Returns whether anything was deleted.
 *
 * The row stays so a future sync can propagate the deletion. Nothing reads it again:
 * every query in this file filters on `deletedAt IS NULL`.
 */
export async function deletePerson(id: string, now = new Date()): Promise<boolean> {
  const deleted = await db
    .update(person)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(person.id, id), alive))
    .returning({ id: person.id });
  return deleted.length > 0;
}

/**
 * Everyone the notification scheduler needs, with their lead time already resolved.
 *
 * One query with a left join rather than N+1 group lookups, then the three-level fallback
 * (person → longest group → app default) is applied in the domain. Muted people are kept
 * and flagged rather than filtered here, so `armWindow` stays the single place that decides
 * who gets a notification.
 */
export async function listSchedulable(
  defaultLeadDays = DEFAULT_SETTINGS.defaultLeadDays,
): Promise<Schedulable[]> {
  const rows = await db
    .select({
      id: person.id,
      displayName: person.displayName,
      birthMonth: person.birthMonth,
      birthDay: person.birthDay,
      birthYear: person.birthYear,
      muted: person.muted,
      personLeadDays: person.leadDays,
      groupLeadDays: group.leadDays,
    })
    .from(person)
    .leftJoin(personGroup, eq(personGroup.personId, person.id))
    .leftJoin(group, and(eq(group.id, personGroup.groupId), isNull(group.deletedAt)))
    .where(alive);

  // The join fans a person out into one row per group membership, so collapse back by id.
  const byPerson = new Map<
    string,
    { row: (typeof rows)[number]; groupLeadDays: (number | null)[] }
  >();
  for (const row of rows) {
    const existing = byPerson.get(row.id);
    if (existing) {
      existing.groupLeadDays.push(row.groupLeadDays);
    } else {
      byPerson.set(row.id, { row, groupLeadDays: [row.groupLeadDays] });
    }
  }

  return [...byPerson.values()].map(({ row, groupLeadDays }) => ({
    id: row.id,
    displayName: row.displayName,
    birthday: makePartialDate(row.birthMonth, row.birthDay, row.birthYear),
    leadDays: resolveLeadDays(row.personLeadDays, groupLeadDays, defaultLeadDays),
    muted: row.muted,
  }));
}

/**
 * Whether a contact has already been imported, so re-importing does not duplicate them.
 *
 * Matches on soft-deleted rows too: a person the user deleted should not silently reappear
 * the next time they import their address book.
 */
export async function findByExternalId(
  source: Person['source'],
  externalId: string,
): Promise<Person | null> {
  const rows = await db
    .select()
    .from(person)
    .where(and(eq(person.source, source), eq(person.externalId, externalId)))
    .limit(1);
  return rows[0] ? toPerson(rows[0]) : null;
}
