/**
 * Turning what someone typed into a person into something storable.
 *
 * This is form logic, but it is pure form logic, so it lives here rather than inside a
 * component where it could only be checked by tapping through the app. The add and edit
 * screens both call it, which is also what stops their validation rules drifting apart.
 */

import { isValidMonthDay, makePartialDate, type PartialDate } from './birthday';

export type PersonDraft = {
  displayName: string;
  month: number | null;
  day: number | null;
  /** As typed. Empty means "I don't know the year" — the common case, not an error. */
  year: string;
  notes: string;
};

export const EMPTY_PERSON_DRAFT: PersonDraft = {
  displayName: '',
  month: null,
  day: null,
  year: '',
  notes: '',
};

export type DraftResult =
  | { ok: true; value: { displayName: string; birthday: PartialDate; notes: string | null } }
  | { ok: false; errors: DraftErrors };

export type DraftErrors = {
  displayName?: string;
  birthday?: string;
  year?: string;
};

const EARLIEST_BIRTH_YEAR = 1800;

/**
 * Validates a draft, collecting *every* problem rather than stopping at the first.
 *
 * Returning one error at a time makes a form feel like it is playing whack-a-mole: fix the
 * name, discover the date is wrong, fix that, discover the year is wrong.
 */
export function parsePersonDraft(draft: PersonDraft, thisYear: number): DraftResult {
  const errors: DraftErrors = {};

  const displayName = draft.displayName.trim();
  if (displayName.length === 0) errors.displayName = 'Give them a name.';

  if (draft.month === null || draft.day === null) {
    errors.birthday = 'Pick a month and a day.';
  } else if (!isValidMonthDay(draft.month, draft.day)) {
    errors.birthday = 'That day does not exist in that month.';
  }

  const year = parseYear(draft.year, thisYear, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      displayName,
      // Safe: the month/day branch above returned early on anything unusable.
      birthday: makePartialDate(draft.month as number, draft.day as number, year),
      notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
    },
  };
}

function parseYear(raw: string, thisYear: number, errors: DraftErrors): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const year = Number(trimmed);
  if (!Number.isInteger(year)) {
    errors.year = 'Use four digits, or leave it blank.';
    return null;
  }
  if (year > thisYear) {
    errors.year = 'That is in the future.';
    return null;
  }
  if (year < EARLIEST_BIRTH_YEAR) {
    errors.year = 'That is too long ago.';
    return null;
  }
  return year;
}

/** The draft that opens the edit screen for an existing person. */
export function draftFromPerson(person: {
  displayName: string;
  birthday: PartialDate;
  notes: string | null;
}): PersonDraft {
  return {
    displayName: person.displayName,
    month: person.birthday.month,
    day: person.birthday.day,
    year: person.birthday.year === null ? '' : String(person.birthday.year),
    notes: person.notes ?? '',
  };
}
