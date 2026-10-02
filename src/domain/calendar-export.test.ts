import { describe, expect, it } from 'vitest';

import { makePartialDate } from './birthday';
import { allDayRange, partialDateFromAllDayStart } from './calendar-date';
import {
  type ExportablePerson,
  type ExportEvent,
  exportEventsFor,
  fingerprintOf,
  LEAP_DAY_HORIZON_YEARS,
  planExportSync,
  UNKNOWN_YEAR_ANCHOR,
} from './calendar-export';

const person = (id: string, month: number, day: number, year?: number): ExportablePerson => ({
  id,
  displayName: id,
  birthday: makePartialDate(month, day, year),
});

const today = new Date(2026, 9, 2);

describe('exportEventsFor', () => {
  it('gives an ordinary birthday one yearly event', () => {
    const events = exportEventsFor([person('Ana', 3, 14)], { today, policy: 'feb28' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      personId: 'Ana',
      title: 'Ana’s birthday',
      recurrence: 'yearly',
      day: { year: UNKNOWN_YEAR_ANCHOR, month: 3, day: 14 },
    });
  });

  it('anchors on the birth year when it is known', () => {
    const [event] = exportEventsFor([person('Ana', 3, 14, 1988)], { today, policy: 'feb28' });

    expect(event.day).toEqual({ year: 1988, month: 3, day: 14 });
  });

  it('does not move the anchor when the year turns over', () => {
    // A moving anchor would rewrite every event in the calendar every 1 January.
    const before = exportEventsFor([person('Ana', 3, 14)], { today, policy: 'feb28' });
    const after = exportEventsFor([person('Ana', 3, 14)], {
      today: new Date(2027, 0, 1),
      policy: 'feb28',
    });

    expect(after.map(fingerprintOf)).toEqual(before.map(fingerprintOf));
  });

  it('puts the birth year in the notes, never an age in the title', () => {
    const [known] = exportEventsFor([person('Ana', 3, 14, 1988)], { today, policy: 'feb28' });
    const [unknown] = exportEventsFor([person('Rui', 3, 14)], { today, policy: 'feb28' });

    expect(known.title).toBe('Ana’s birthday');
    expect(known.notes).toMatch(/^Born 1988\./);
    expect(unknown.notes).not.toMatch(/Born|null/);
  });

  it('uses a bare apostrophe after a final s', () => {
    const [event] = exportEventsFor([person('Lucas', 5, 2)], { today, policy: 'feb28' });

    expect(event.title).toBe('Lucas’ birthday');
  });

  describe('29 February', () => {
    const leapling = person('Leo', 2, 29);

    it('exports one-shot events, never a yearly rule on the 29th', () => {
      const events = exportEventsFor([leapling], { today, policy: 'feb28' });

      expect(events).toHaveLength(LEAP_DAY_HORIZON_YEARS);
      expect(events.every((event) => event.recurrence === 'once')).toBe(true);
    });

    it('lands on the 28th in common years under feb28, and on the 29th in leap years', () => {
      const days = exportEventsFor([leapling], { today, policy: 'feb28' }).map(
        (event) => event.day,
      );

      expect(days).toEqual([
        { year: 2026, month: 2, day: 28 },
        { year: 2027, month: 2, day: 28 },
        { year: 2028, month: 2, day: 29 },
        { year: 2029, month: 2, day: 28 },
        { year: 2030, month: 2, day: 28 },
        { year: 2031, month: 2, day: 28 },
        { year: 2032, month: 2, day: 29 },
        { year: 2033, month: 2, day: 28 },
      ]);
    });

    it('lands on 1 March in common years under mar1', () => {
      const days = exportEventsFor([leapling], { today, policy: 'mar1' }).map((event) => event.day);

      expect(days[0]).toEqual({ year: 2026, month: 3, day: 1 });
      expect(days[2]).toEqual({ year: 2028, month: 2, day: 29 });
    });

    it('rewrites the events when the policy changes', () => {
      const feb28 = exportEventsFor([leapling], { today, policy: 'feb28' });
      const mar1 = exportEventsFor([leapling], { today, policy: 'mar1' });

      const plan = planExportSync(
        mar1,
        feb28.map((event, i) => ({ eventId: `e${i}`, fingerprint: fingerprintOf(event) })),
      );

      // The two leap years are the same date under both policies and stay put.
      expect(plan.create).toHaveLength(LEAP_DAY_HORIZON_YEARS - 2);
      expect(plan.remove).toHaveLength(LEAP_DAY_HORIZON_YEARS - 2);
    });
  });
});

describe('planExportSync', () => {
  const written = (events: ExportEvent[]) =>
    events.map((event, i) => ({ eventId: `e${i}`, fingerprint: fingerprintOf(event) }));
  const opts = { today, policy: 'feb28' as const };

  it('creates everything into an empty calendar', () => {
    const desired = exportEventsFor([person('Ana', 3, 14), person('Rui', 7, 1)], opts);

    expect(planExportSync(desired, [])).toEqual({ create: desired, remove: [] });
  });

  it('does nothing when the calendar already matches', () => {
    const desired = exportEventsFor([person('Ana', 3, 14), person('Rui', 7, 1)], opts);

    expect(planExportSync(desired, written(desired))).toEqual({ create: [], remove: [] });
  });

  it('replaces the event of a person whose birthday changed', () => {
    const before = exportEventsFor([person('Ana', 3, 14), person('Rui', 7, 1)], opts);
    const after = exportEventsFor([person('Ana', 3, 15), person('Rui', 7, 1)], opts);

    const plan = planExportSync(after, written(before));

    expect(plan.remove).toEqual(['e0']);
    expect(plan.create.map((event) => event.day.day)).toEqual([15]);
  });

  it('replaces the event of a person who was renamed', () => {
    const before = exportEventsFor([person('Ana', 3, 14)], opts);
    const after = exportEventsFor([{ ...person('Ana', 3, 14), displayName: 'Ana Lima' }], opts);

    const plan = planExportSync(after, written(before));

    expect(plan.remove).toEqual(['e0']);
    expect(plan.create[0].title).toBe('Ana Lima’s birthday');
  });

  it('removes the events of people who are gone', () => {
    const before = exportEventsFor([person('Ana', 3, 14), person('Rui', 7, 1)], opts);
    const after = exportEventsFor([person('Rui', 7, 1)], opts);

    expect(planExportSync(after, written(before))).toEqual({ create: [], remove: ['e0'] });
  });

  it('keeps two people who share a name and a birthday as two events', () => {
    const twins = [
      { id: 'a', displayName: 'Sam', birthday: makePartialDate(4, 1) },
      { id: 'b', displayName: 'Sam', birthday: makePartialDate(4, 1) },
    ];
    const desired = exportEventsFor(twins, opts);

    expect(planExportSync(desired, written(desired.slice(0, 1))).create).toEqual([desired[1]]);
  });

  it('removes a duplicate the bookkeeping holds twice', () => {
    const desired = exportEventsFor([person('Ana', 3, 14)], opts);
    const fingerprint = fingerprintOf(desired[0]);

    const plan = planExportSync(desired, [
      { eventId: 'first', fingerprint },
      { eventId: 'second', fingerprint },
    ]);

    expect(plan).toEqual({ create: [], remove: ['second'] });
  });
});

/**
 * Like the decoder's tests, these mean most under `npm run test:tz` (UTC−3), where a local
 * midnight and a UTC midnight are three hours and — for the UTC encoding read back locally —
 * a whole day apart.
 */
describe('allDayRange', () => {
  it('encodes a day as UTC midnight to the next UTC midnight for Android', () => {
    const { start, end } = allDayRange({ year: 2027, month: 1, day: 25 }, 'utc-midnight');

    expect(start.toISOString()).toBe('2027-01-25T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-26T00:00:00.000Z');
  });

  it('rolls the end over a year boundary', () => {
    const { end } = allDayRange({ year: 2026, month: 12, day: 31 }, 'utc-midnight');

    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('encodes a day as local midnight for iOS, ending where it starts', () => {
    const { start, end } = allDayRange({ year: 2027, month: 1, day: 25 }, 'local-midnight');

    expect([start.getFullYear(), start.getMonth() + 1, start.getDate()]).toEqual([2027, 1, 25]);
    expect([start.getHours(), start.getMinutes()]).toEqual([0, 0]);
    expect(end.getTime()).toBe(start.getTime());
  });

  it('round-trips through the import decoder on the Android encoding', () => {
    const { start } = allDayRange({ year: 2028, month: 2, day: 29 }, 'utc-midnight');

    expect(partialDateFromAllDayStart(start)).toEqual({ month: 2, day: 29, year: null });
  });
});
