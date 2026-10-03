/**
 * The group repository. Every write to a group or a membership goes through here.
 *
 * The one rule this file exists to keep: **a person's `updatedAt` moves when — and only when —
 * a group change moves their lead time.** `updatedAt` is what `Schedulable.knownSince` reads,
 * and a `knownSince` newer than a reminder's moment licenses the scheduler to catch that
 * reminder up — so stamping everyone in a group on every edit would re-send reminders that
 * already fired, once a day until the birthday (the trap `setTone` documents in `people.ts`).
 * Not stamping anyone would be wrong the other way: a group raised from "on the day" to "a
 * week before" must catch up members whose birthday is in three days, exactly as raising the
 * app default does. So each write below compares every affected member's resolved lead time
 * before and after, inside one transaction, and stamps only the people whose answer changed.
 *
 * The group's own `updatedAt` is free to move on every edit: nothing schedules off it.
 *
 * Transactions here are synchronous — `expo-sqlite`'s Drizzle session runs the callback
 * inline, so every query inside uses `.all()`, `.get()` or `.run()` rather than `await`.
 */

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import { type Group, leadChanges, parseGroupName } from '@/domain/group';
import type { Tone } from '@/domain/message';
import { db } from './client';
import { toGroup, toSettings } from './mappers';
import { group, person, personGroup, settings } from './schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type GroupWrite = { ok: true; group: Group } | { ok: false; error: string };

const aliveGroup = isNull(group.deletedAt);

/**
 * Creates a group, or says why the name will not do.
 *
 * Validated here as well as on the screen, against the names that exist at the moment of the
 * write, so two quick taps on "Family" cannot make two of them.
 */
export async function createGroup(rawName: string, now = new Date()): Promise<GroupWrite> {
  return db.transaction((tx) => {
    const parsed = parseGroupName(rawName, liveNames(tx));
    if (!parsed.ok) return parsed;

    const created = tx
      .insert(group)
      .values({ id: randomUUID(), name: parsed.value, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return { ok: true, group: toGroup(created) };
  });
}

/** Renames a group, or says why the name will not do. A rename never touches the schedule. */
export async function renameGroup(
  id: string,
  rawName: string,
  now = new Date(),
): Promise<GroupWrite> {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(group)
      .where(and(eq(group.id, id), aliveGroup))
      .get();
    if (!current) return { ok: false, error: 'This group has been removed.' };

    const parsed = parseGroupName(rawName, liveNames(tx), current.name);
    if (!parsed.ok) return parsed;

    const updated = tx
      .update(group)
      .set({ name: parsed.value, updatedAt: now })
      .where(eq(group.id, id))
      .returning()
      .get();
    return { ok: true, group: toGroup(updated) };
  });
}

/** Sets the lead time members inherit. Null means the group has no opinion. */
export async function setGroupLeadDays(
  id: string,
  leadDays: number | null,
  now = new Date(),
): Promise<void> {
  db.transaction((tx) => {
    stampWhereLeadMoved(tx, memberIds(tx, id), now, () => {
      tx.update(group)
        .set({ leadDays, updatedAt: now })
        .where(and(eq(group.id, id), aliveGroup))
        .run();
    });
  });
}

/**
 * Sets the tone members' messages open on. Null means the group has no opinion.
 *
 * Touches no person: tone is not part of the schedule.
 */
export async function setGroupTone(id: string, tone: Tone | null, now = new Date()): Promise<void> {
  await db
    .update(group)
    .set({ tone, updatedAt: now })
    .where(and(eq(group.id, id), aliveGroup));
}

/**
 * Soft-deletes a group. Its members stay; they just stop inheriting from it.
 *
 * Memberships are left in place rather than removed: every read joins only live groups, so
 * they are inert, and keeping them means the delete is one row a future sync can see.
 */
export async function deleteGroup(id: string, now = new Date()): Promise<void> {
  db.transaction((tx) => {
    stampWhereLeadMoved(tx, memberIds(tx, id), now, () => {
      tx.update(group)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(group.id, id), aliveGroup))
        .run();
    });
  });
}

/** Adds someone to a group or takes them out of it. The group screen's member toggle. */
export async function setGroupMember(
  groupId: string,
  personId: string,
  member: boolean,
  now = new Date(),
): Promise<void> {
  db.transaction((tx) => {
    stampWhereLeadMoved(tx, [personId], now, () => {
      if (member) {
        tx.insert(personGroup).values({ personId, groupId }).onConflictDoNothing().run();
      } else {
        tx.delete(personGroup)
          .where(and(eq(personGroup.personId, personId), eq(personGroup.groupId, groupId)))
          .run();
      }
    });
  });
}

/**
 * Makes a person's groups exactly `groupIds`. The person screen's save.
 *
 * Replaces the whole set rather than diffing in the caller, so the form can hold a plain
 * list of ticked groups and not care what was there before.
 */
export async function setPersonGroups(
  personId: string,
  groupIds: readonly string[],
  now = new Date(),
): Promise<void> {
  db.transaction((tx) => {
    stampWhereLeadMoved(tx, [personId], now, () => {
      tx.delete(personGroup).where(eq(personGroup.personId, personId)).run();
      if (groupIds.length > 0) {
        tx.insert(personGroup)
          .values([...new Set(groupIds)].map((groupId) => ({ personId, groupId })))
          .run();
      }
    });
  });
}

function liveNames(tx: Tx): string[] {
  return tx
    .select({ name: group.name })
    .from(group)
    .where(aliveGroup)
    .orderBy(asc(group.name))
    .all()
    .map((row) => row.name);
}

function memberIds(tx: Tx, groupId: string): string[] {
  return tx
    .select({ personId: personGroup.personId })
    .from(personGroup)
    .where(eq(personGroup.groupId, groupId))
    .all()
    .map((row) => row.personId);
}

/**
 * Runs `write`, then stamps `updatedAt` on exactly those of `personIds` whose resolved lead
 * time it changed. See the file comment for why it is exactly those.
 */
function stampWhereLeadMoved(tx: Tx, personIds: string[], now: Date, write: () => void): void {
  if (personIds.length === 0) {
    write();
    return;
  }

  const { defaultLeadDays } = toSettings(tx.select().from(settings).limit(1).get());
  const before = leadInputs(tx, personIds);
  write();
  const after = leadInputs(tx, personIds);

  const moved = [...before].flatMap(([id, was]) => {
    const is = after.get(id);
    return is && leadChanges(was.own, was.groups, is.groups, defaultLeadDays) ? [id] : [];
  });

  if (moved.length > 0) {
    tx.update(person).set({ updatedAt: now }).where(inArray(person.id, moved)).run();
  }
}

/**
 * Each live person's own lead time and their live groups' lead times — the same inputs
 * `listSchedulable` hands to `resolveLeadDays`, read the same way.
 */
function leadInputs(
  tx: Tx,
  personIds: string[],
): Map<string, { own: number | null; groups: (number | null)[] }> {
  const rows = tx
    .select({ id: person.id, own: person.leadDays, groupLead: group.leadDays, groupId: group.id })
    .from(person)
    .leftJoin(personGroup, eq(personGroup.personId, person.id))
    .leftJoin(group, and(eq(group.id, personGroup.groupId), aliveGroup))
    .where(and(inArray(person.id, personIds), isNull(person.deletedAt)))
    .all();

  const inputs = new Map<string, { own: number | null; groups: (number | null)[] }>();
  for (const row of rows) {
    const entry = inputs.get(row.id) ?? { own: row.own, groups: [] };
    // A left join with no live group still yields a row; it contributes nothing.
    if (row.groupId !== null) entry.groups.push(row.groupLead);
    inputs.set(row.id, entry);
  }
  return inputs;
}
