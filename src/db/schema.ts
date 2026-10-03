/**
 * The local SQLite schema.
 *
 * Three choices here exist only to make the v2 opt-in account (automatic backup + ask-link)
 * possible later. They are nearly free now and impossible to retrofit:
 *
 * 1. **UUID text primary keys, not autoincrement integers.** Two devices must be able to
 *    create rows offline without colliding on an id.
 * 2. **`updatedAt` on every row and `deletedAt` soft deletes.** A hard delete is invisible to
 *    a later sync, so restoring a backup would silently resurrect people the user removed.
 * 3. **Nothing here is queried directly by a screen.** Everything goes through the repository
 *    functions in this folder, which is where v2 will enqueue changes for backup.
 *
 * Dates are stored as epoch milliseconds. Birthdays are *not* dates — they are a month, a
 * day, and an optional year, stored as three columns. See `src/domain/birthday.ts`.
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Type-only, and it points at the domain rather than the other way round: the domain never
// imports the database. One definition of the source union, used to type the column.
import type { SkipKind } from '@/domain/import';
import type { Tone } from '@/domain/message';
import type { PersonSource } from '@/domain/person';

const now = sql`(unixepoch() * 1000)`;

export const person = sqliteTable(
  'person',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),

    /** 1–12. */
    birthMonth: integer('birth_month').notNull(),
    /** 1–31, validated against the month by the domain layer. */
    birthDay: integer('birth_day').notNull(),
    /** Null is the common case: you know the day, not the year. */
    birthYear: integer('birth_year'),

    notes: text('notes'),

    /** Per-person override for how many days early to be reminded. Null falls back. */
    leadDays: integer('lead_days'),
    /** Muted people stay in the list and out of the notification window. */
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),

    source: text('source').$type<PersonSource>().notNull().default('manual'),
    /** The contact/event id this row was imported from, for re-import de-duplication. */
    externalId: text('external_id'),
    /**
     * Relationship tone for suggested messages. Null means the user has never chosen one —
     * kept distinct from 'close' so a future groups-derived tone can fill in only where
     * nobody has decided.
     */
    tone: text('tone').$type<Tone>(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    /** Soft delete. Every read must filter on this being null. */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    // The Upcoming list sorts by month/day across the whole table on every render.
    index('person_birthday_idx').on(table.birthMonth, table.birthDay),
    // Import checks "have I already got this contact?" once per candidate.
    index('person_external_idx').on(table.source, table.externalId),
  ],
);

export const group = sqliteTable('group', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Default lead time for members who have no override of their own. */
  leadDays: integer('lead_days'),
  /** Default message tone for members who never chose one. Null means no opinion. */
  tone: text('tone').$type<Tone>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

/**
 * Group membership.
 *
 * The one table without `updatedAt`/`deletedAt`: leaving a group deletes the row. A
 * membership has no state beyond existing, so the v2 backup can treat a person's groups as a
 * set it replaces whole — the person's own `updatedAt` moves when their schedule does, and
 * the group's on every edit to it. Adding the columns later would need a table
 * rebuild, since SQLite cannot `ADD COLUMN` with the expression default the other tables use.
 */
export const personGroup = sqliteTable(
  'person_group',
  {
    personId: text('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => group.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.personId, table.groupId] }),
    index('person_group_group_idx').on(table.groupId),
  ],
);

/**
 * Contacts the user explicitly declined to add, so the triage deck never asks twice.
 *
 * Keyed by source + external id rather than by person, because the whole point is that no
 * person row exists. Without this, every re-import replays the entire address book.
 */
export const skipped = sqliteTable(
  'skipped',
  {
    source: text('source').$type<PersonSource>().notNull(),
    externalId: text('external_id').notNull(),
    /**
     * 'deferred' — skipped for now. 'refused' — don't ask again.
     *
     * Defaults to 'refused' because every row written before this column existed came from
     * the don't-ask-again path.
     */
    kind: text('kind').$type<SkipKind>().notNull().default('refused'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.source, table.externalId] })],
);

/**
 * App settings as a single row, pinned to id 1.
 *
 * A key/value table would need every read to parse strings and handle a missing key. One
 * typed row is smaller, and the defaults live in exactly one place.
 */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey().default(1),
  /** Default days of lead time, when neither the person nor their groups override it. */
  defaultLeadDays: integer('default_lead_days').notNull().default(0),
  /** Local time of day reminders fire at. */
  notifyHour: integer('notify_hour').notNull().default(9),
  notifyMinute: integer('notify_minute').notNull().default(0),
  /** 'feb28' | 'mar1' — see LeapDayPolicy in src/domain/birthday.ts. */
  leapDayPolicy: text('leap_day_policy').notNull().default('feb28'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

/**
 * Calendar export's own state, as a single row pinned to id 1.
 *
 * Not columns on `settings`, though it is a preference the user sets. `settings.updatedAt`
 * feeds `Schedulable.knownSince`, and a newer `knownSince` licenses the scheduler to catch up
 * reminders whose moment already passed — so toggling export through `updateSettings` would
 * re-send a reminder that fired this morning. Same trap `setTone` documents in `people.ts`.
 */
export const calendarExport = sqliteTable('calendar_export', {
  id: integer('id').primaryKey().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** The device calendar Nenrin created and owns. Null until the first sync creates it. */
  calendarId: text('calendar_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

/**
 * Every event Nenrin has written into its calendar, and what it was written from.
 *
 * The app cannot ask the calendar what it holds: on Android `expo-calendar` filters every
 * event query on the calendar being visible, so a user who hides Nenrin's calendar would make
 * it look empty and get every birthday written a second time. This table is the record
 * instead, and `fingerprint` is how a sync tells a still-correct event from a stale one.
 *
 * No foreign key to `person`: deletes are soft, so a removed person's row stays, and this
 * table must still say which event to take out of the calendar for them.
 */
export const exportedEvent = sqliteTable('exported_event', {
  eventId: text('event_id').primaryKey(),
  personId: text('person_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

export type PersonRow = typeof person.$inferSelect;
export type NewPersonRow = typeof person.$inferInsert;
export type GroupRow = typeof group.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
