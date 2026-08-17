import { describe, expect, it } from 'vitest';

import { toNewPersonRow, toPeople, toPerson, toPersonSafe, toPersonUpdate } from './mappers';
import type { PersonRow } from './schema';

const at = new Date(2026, 7, 9, 12, 0);

const row = (overrides: Partial<PersonRow> = {}): PersonRow => ({
  id: 'p1',
  displayName: 'Ana Paula',
  birthMonth: 3,
  birthDay: 14,
  birthYear: 1988,
  notes: null,
  leadDays: null,
  muted: false,
  source: 'manual',
  externalId: null,
  tone: null,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  ...overrides,
});

describe('toPerson', () => {
  it('builds the birthday from the three columns', () => {
    expect(toPerson(row()).birthday).toEqual({ month: 3, day: 14, year: 1988 });
  });

  it('keeps a missing birth year as null rather than inventing one', () => {
    expect(toPerson(row({ birthYear: null })).birthday.year).toBeNull();
  });

  it('carries the rest of the row through unchanged', () => {
    const person = toPerson(row({ notes: 'loves cake', leadDays: 7, muted: true }));
    expect(person).toMatchObject({
      id: 'p1',
      displayName: 'Ana Paula',
      notes: 'loves cake',
      leadDays: 7,
      muted: true,
      source: 'manual',
    });
  });

  it('refuses to hand a screen an impossible date', () => {
    // Rows can also arrive from a restored backup or a future sync, neither of which the
    // app's own validation ever touched.
    expect(() => toPerson(row({ birthMonth: 2, birthDay: 31 }))).toThrow();
  });
});

describe('toPersonSafe and toPeople', () => {
  it('maps a good row exactly as toPerson does', () => {
    expect(toPersonSafe(row())).toEqual(toPerson(row()));
  });

  it('returns null for a row toPerson would reject', () => {
    expect(toPersonSafe(row({ birthMonth: 2, birthDay: 31 }))).toBeNull();
  });

  it('drops a corrupt row rather than taking the whole list down with it', () => {
    // Losing 1 of 200 people is recoverable. A list screen that throws is not.
    const rows = [row({ id: 'ok1' }), row({ id: 'bad', birthMonth: 13 }), row({ id: 'ok2' })];
    expect(toPeople(rows).map((p) => p.id)).toEqual(['ok1', 'ok2']);
  });

  it('maps an entirely healthy list untouched', () => {
    expect(toPeople([row({ id: 'a' }), row({ id: 'b' })])).toHaveLength(2);
  });
});

describe('toNewPersonRow', () => {
  it('splits the birthday across columns and stamps both timestamps', () => {
    const created = toNewPersonRow({ displayName: 'Bo', birthday: { month: 6, day: 2 } }, 'p2', at);
    expect(created).toMatchObject({
      id: 'p2',
      birthMonth: 6,
      birthDay: 2,
      birthYear: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  });

  it('defaults an unspecified person to a manual entry that is not muted', () => {
    const created = toNewPersonRow({ displayName: 'Bo', birthday: { month: 6, day: 2 } }, 'p2', at);
    expect(created.source).toBe('manual');
    expect(created.muted).toBe(false);
    expect(created.externalId).toBeNull();
  });

  it('trims the name, because contacts imports are full of stray whitespace', () => {
    const created = toNewPersonRow(
      { displayName: '  Ana Paula  ', birthday: { month: 3, day: 14 } },
      'p1',
      at,
    );
    expect(created.displayName).toBe('Ana Paula');
  });

  it('validates before writing, so a bad date never reaches the table', () => {
    expect(() =>
      toNewPersonRow({ displayName: 'Bo', birthday: { month: 4, day: 31 } }, 'p2', at),
    ).toThrow();
  });

  it('accepts 29 February', () => {
    const created = toNewPersonRow(
      { displayName: 'Leap', birthday: { month: 2, day: 29, year: 2000 } },
      'p3',
      at,
    );
    expect(created).toMatchObject({ birthMonth: 2, birthDay: 29, birthYear: 2000 });
  });
});

describe('toPersonUpdate', () => {
  const later = new Date(2026, 7, 10, 8, 0);

  it('always refreshes updatedAt', () => {
    expect(toPersonUpdate({}, later).updatedAt).toBe(later);
  });

  it('touches nothing else when the patch is empty', () => {
    expect(Object.keys(toPersonUpdate({}, later))).toEqual(['updatedAt']);
  });

  it('distinguishes clearing a field from leaving it alone', () => {
    // The bug this guards: `notes ?? existing` cannot tell "set to null" from "not supplied",
    // so clearing a note would silently do nothing.
    expect('notes' in toPersonUpdate({ notes: null }, later)).toBe(true);
    expect(toPersonUpdate({ notes: null }, later).notes).toBeNull();
    expect('notes' in toPersonUpdate({ muted: true }, later)).toBe(false);
  });

  it('treats a lead time of 0 as a real value', () => {
    expect(toPersonUpdate({ leadDays: 0 }, later).leadDays).toBe(0);
  });

  it('clears a lead-time override back to inherited', () => {
    expect(toPersonUpdate({ leadDays: null }, later).leadDays).toBeNull();
  });

  it('expands a birthday into all three columns at once', () => {
    const update = toPersonUpdate({ birthday: { month: 12, day: 25, year: 1990 } }, later);
    expect(update).toMatchObject({ birthMonth: 12, birthDay: 25, birthYear: 1990 });
  });

  it('clears the year when a birthday is patched without one', () => {
    // Correcting "I thought it was 1988" back to "day and month only" must not leave the
    // stale year behind.
    const update = toPersonUpdate({ birthday: { month: 12, day: 25 } }, later);
    expect(update.birthYear).toBeNull();
  });

  it('validates the patched birthday', () => {
    expect(() => toPersonUpdate({ birthday: { month: 2, day: 30 } }, later)).toThrow();
  });

  it('never lets a patch rewrite provenance or identity', () => {
    const update = toPersonUpdate({ displayName: 'Ana' }, later);
    expect('id' in update).toBe(false);
    expect('source' in update).toBe(false);
    expect('externalId' in update).toBe(false);
    expect('createdAt' in update).toBe(false);
  });
});

describe('tone', () => {
  it('carries a stored tone through to the domain', () => {
    expect(toPerson(row({ tone: 'family' })).tone).toBe('family');
  });

  it('keeps an unset tone as null rather than defaulting at the boundary', () => {
    // DEFAULT_TONE is applied where the messages are shown, not here. Writing a default
    // into the row would make "never chosen" indistinguishable from a real choice.
    expect(toPerson(row({ tone: null })).tone).toBeNull();
  });

  it('defaults a new person to no tone', () => {
    const created = toNewPersonRow(
      { displayName: 'Ana', birthday: { month: 3, day: 14 } },
      'p2',
      at,
    );

    expect(created.tone).toBeNull();
  });

  it('lets a caller set a tone at creation', () => {
    const created = toNewPersonRow(
      { displayName: 'Ana', birthday: { month: 3, day: 14 }, tone: 'colleague' },
      'p2',
      at,
    );

    expect(created.tone).toBe('colleague');
  });
});
