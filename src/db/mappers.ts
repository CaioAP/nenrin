/**
 * Translation between database rows and domain objects.
 *
 * Deliberately free of any Expo or expo-sqlite import so it runs — and is tested — in plain
 * Node. The rest of `src/db` needs a device; this file is where the fiddly part lives, so the
 * fiddly part stays testable.
 */

import { type LeapDayPolicy, makePartialDate } from '@/domain/birthday';
import type { Person } from '@/domain/person';
import { type AppSettings, DEFAULT_SETTINGS } from '@/domain/settings';
import type { NewPersonRow, PersonRow, SettingsRow } from './schema';

/** What a caller must supply to create a person. Ids and timestamps are the repository's job. */
export type NewPerson = {
  displayName: string;
  birthday: { month: number; day: number; year?: number | null };
  notes?: string | null;
  leadDays?: number | null;
  muted?: boolean;
  source?: Person['source'];
  externalId?: string | null;
};

/**
 * Row → domain.
 *
 * `makePartialDate` validates on the way out as well as in. SQLite has no check constraints
 * here, and a row can also arrive from a future sync or a hand-edited backup — so the
 * boundary refuses to hand a screen a 31 February.
 */
export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.displayName,
    birthday: makePartialDate(row.birthMonth, row.birthDay, row.birthYear),
    notes: row.notes,
    leadDays: row.leadDays,
    muted: row.muted,
    source: row.source,
    externalId: row.externalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Row → domain, returning null instead of throwing.
 *
 * For list screens. `toPerson` is right when a single person is being read or written —
 * failing loudly beats showing a wrong date. But a list must not white-screen because one
 * corrupt row exists: losing 1 of 200 people is recoverable, losing the whole app is not.
 */
export function toPersonSafe(row: PersonRow): Person | null {
  try {
    return toPerson(row);
  } catch {
    return null;
  }
}

/** Maps a set of rows for display, dropping any that cannot be represented. */
export function toPeople(rows: PersonRow[]): Person[] {
  return rows.map(toPersonSafe).filter((person): person is Person => person !== null);
}

/**
 * Domain → row, for an insert.
 *
 * Validates before writing, so an impossible date cannot reach the table in the first place.
 */
export function toNewPersonRow(input: NewPerson, id: string, at: Date): NewPersonRow {
  const birthday = makePartialDate(input.birthday.month, input.birthday.day, input.birthday.year);

  return {
    id,
    displayName: input.displayName.trim(),
    birthMonth: birthday.month,
    birthDay: birthday.day,
    birthYear: birthday.year,
    notes: input.notes ?? null,
    leadDays: input.leadDays ?? null,
    muted: input.muted ?? false,
    source: input.source ?? 'manual',
    externalId: input.externalId ?? null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

/** The fields a person edit may touch. Ids, timestamps and provenance are not editable. */
export type PersonPatch = Partial<
  Pick<NewPerson, 'displayName' | 'birthday' | 'notes' | 'leadDays' | 'muted'>
>;

/**
 * A patch → the columns to set, always including a fresh `updatedAt`.
 *
 * Only keys actually present in the patch are emitted. That matters because `notes` and
 * `leadDays` are meaningfully nullable: `{ notes: null }` must clear the note, while omitting
 * `notes` must leave it alone. A naive `?? existing` spread cannot tell those apart.
 */
export function toPersonUpdate(patch: PersonPatch, at: Date): Partial<NewPersonRow> {
  const update: Partial<NewPersonRow> = { updatedAt: at };

  if (patch.displayName !== undefined) update.displayName = patch.displayName.trim();
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.leadDays !== undefined) update.leadDays = patch.leadDays;
  if (patch.muted !== undefined) update.muted = patch.muted;

  if (patch.birthday !== undefined) {
    const birthday = makePartialDate(patch.birthday.month, patch.birthday.day, patch.birthday.year);
    update.birthMonth = birthday.month;
    update.birthDay = birthday.day;
    update.birthYear = birthday.year;
  }

  return update;
}

/**
 * Settings row → domain, tolerating no row at all.
 *
 * A fresh install has run its migrations and written nothing, so "missing" is the normal
 * first state rather than an error. Both the one-shot read and the live query go through
 * here so they cannot disagree about what an unconfigured app does.
 */
export function toSettings(row: SettingsRow | undefined): AppSettings {
  if (!row) return DEFAULT_SETTINGS;

  return {
    defaultLeadDays: row.defaultLeadDays,
    notifyHour: row.notifyHour,
    notifyMinute: row.notifyMinute,
    // A plain TEXT column, so a hand-edited database or a future sync could carry anything.
    // Fall back rather than handing an unknown policy to the date maths.
    leapDayPolicy: isLeapDayPolicy(row.leapDayPolicy)
      ? row.leapDayPolicy
      : DEFAULT_SETTINGS.leapDayPolicy,
    updatedAt: row.updatedAt,
  };
}

function isLeapDayPolicy(value: string): value is LeapDayPolicy {
  return value === 'feb28' || value === 'mar1';
}
