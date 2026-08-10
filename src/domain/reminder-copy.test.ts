import { describe, expect, it } from 'vitest';

import { possessive, reminderCopy } from './reminder-copy';
import type { Reminder } from './schedule';

const at = (year: number, month: number, day: number, hour = 9, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  personId: 'ana',
  displayName: 'Ana',
  fireAt: at(2026, 3, 14),
  occursOn: at(2026, 3, 14, 0, 0),
  turningAge: null,
  ...overrides,
});

describe('possessive', () => {
  it('adds an apostrophe and an s', () => {
    expect(possessive('Ana')).toBe('Ana’s');
  });

  it('adds only an apostrophe to a name already ending in s', () => {
    expect(possessive('Lucas')).toBe('Lucas’');
  });

  it('ignores the case of the trailing s', () => {
    expect(possessive('LUCAS')).toBe('LUCAS’');
  });

  it('does not treat a trailing s-like letter as an s', () => {
    expect(possessive('Beatriz')).toBe('Beatriz’s');
  });
});

describe('reminderCopy', () => {
  it('says today when the reminder fires on the birthday', () => {
    const { title } = reminderCopy(reminder());
    expect(title).toBe('Ana’s birthday is today');
  });

  it('says tomorrow when the reminder fires a day early', () => {
    const { title } = reminderCopy(reminder({ fireAt: at(2026, 3, 13) }));
    expect(title).toBe('Ana’s birthday is tomorrow');
  });

  it('counts the days when the reminder fires further ahead', () => {
    const { title } = reminderCopy(reminder({ fireAt: at(2026, 3, 7) }));
    expect(title).toBe('Ana’s birthday is in 7 days');
  });

  it('ignores the time of day when counting the days', () => {
    // Fires at 21:00 the night before, for a birthday that "starts" at midnight. That is one
    // day away, not zero — an hours-based subtraction would round it to today.
    const { title } = reminderCopy(reminder({ fireAt: at(2026, 3, 13, 21, 0) }));
    expect(title).toBe('Ana’s birthday is tomorrow');
  });

  it('carries the date in the body', () => {
    expect(reminderCopy(reminder()).body).toBe('Sat, 14 Mar');
  });

  it('adds the age to the body when the birth year is known', () => {
    expect(reminderCopy(reminder({ turningAge: 38 })).body).toBe('Sat, 14 Mar · turning 38');
  });

  it('crosses a daylight-saving boundary without losing a day', () => {
    // Europe/London springs forward on 29 March 2026, so 22 → 29 March is 167 hours, not 168.
    const { title } = reminderCopy(
      reminder({ fireAt: at(2026, 3, 22), occursOn: at(2026, 3, 29, 0, 0) }),
    );
    expect(title).toBe('Ana’s birthday is in 7 days');
  });
});
