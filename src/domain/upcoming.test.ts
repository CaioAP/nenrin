import { describe, expect, it } from 'vitest';

import { makePartialDate } from './birthday';
import type { Person } from './person';
import { describeDaysAway, upcoming } from './upcoming';

const at = (year: number, month: number, day: number) => new Date(year, month - 1, day);

const person = (displayName: string, month: number, day: number, year?: number): Person => ({
  id: displayName,
  displayName,
  birthday: makePartialDate(month, day, year),
  notes: null,
  leadDays: null,
  muted: false,
  source: 'manual',
  externalId: null,
  createdAt: at(2026, 1, 1),
  updatedAt: at(2026, 1, 1),
});

const namesOf = (entries: ReturnType<typeof upcoming>) => entries.map((e) => e.person.displayName);

describe('upcoming', () => {
  const now = at(2026, 8, 9);

  it('is empty for nobody', () => {
    expect(upcoming([], now)).toEqual([]);
  });

  it('orders by how soon the birthday is, wrapping around the year', () => {
    const people = [person('january', 1, 5), person('august', 8, 20), person('december', 12, 1)];
    expect(namesOf(upcoming(people, now))).toEqual(['august', 'december', 'january']);
  });

  it('puts a birthday happening today first, not last', () => {
    // The bug this guards: treating "already passed" as ">= today" pushes today's birthday
    // to the far end of the list on the one morning it matters.
    const people = [person('tomorrow', 8, 10), person('today', 8, 9)];
    expect(namesOf(upcoming(people, now))).toEqual(['today', 'tomorrow']);
    expect(upcoming(people, now)[0].daysAway).toBe(0);
  });

  it('breaks ties on name so the order does not shuffle between renders', () => {
    const people = [person('Zoe', 8, 20), person('Ana', 8, 20)];
    expect(namesOf(upcoming(people, now))).toEqual(['Ana', 'Zoe']);
  });

  it('reports the age they are turning, and null without a birth year', () => {
    const entries = upcoming([person('known', 8, 20, 1988), person('unknown', 8, 21)], now);
    expect(entries[0].turningAge).toBe(38);
    expect(entries[1].turningAge).toBeNull();
  });

  it('adjusts a leap-day birthday and orders on the adjusted date', () => {
    const entries = upcoming([person('leap', 2, 29, 2000)], at(2027, 2, 20));
    expect(entries[0].occursOn).toEqual(at(2027, 2, 28));
    expect(entries[0].daysAway).toBe(8);
  });

  it('is not capped the way the notification window is', () => {
    const crowd = Array.from({ length: 300 }, (_, i) =>
      person(`p${i}`, (i % 12) + 1, (i % 28) + 1),
    );
    expect(upcoming(crowd, now)).toHaveLength(300);
  });

  it('includes muted people — muting silences notifications, it does not hide anyone', () => {
    const quiet = { ...person('quiet', 8, 20), muted: true };
    expect(namesOf(upcoming([quiet], now))).toEqual(['quiet']);
  });
});

describe('describeDaysAway', () => {
  it('names today and tomorrow rather than counting', () => {
    expect(describeDaysAway(0)).toBe('Today');
    expect(describeDaysAway(1)).toBe('Tomorrow');
  });

  it('counts the days within the week', () => {
    expect(describeDaysAway(3)).toBe('In 3 days');
  });

  it('says next week rather than a number just past the boundary', () => {
    expect(describeDaysAway(9)).toBe('Next week');
  });

  it('goes back to counting further out', () => {
    expect(describeDaysAway(40)).toBe('In 40 days');
  });
});
