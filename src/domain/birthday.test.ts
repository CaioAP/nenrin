import { describe, expect, it } from 'vitest';

import {
  ageAtNextOccurrence,
  ageOn,
  daysUntil,
  isValidMonthDay,
  makePartialDate,
  nextOccurrence,
  occurrenceInYear,
  startOfDay,
} from './birthday';

/** Local midnight, so every expectation is in the same calendar frame as the code. */
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day);

describe('makePartialDate', () => {
  it('accepts a full date', () => {
    expect(makePartialDate(3, 14, 1988)).toEqual({ month: 3, day: 14, year: 1988 });
  });

  it('accepts a day/month with no year — the common case for a birthday you half-remember', () => {
    expect(makePartialDate(3, 14)).toEqual({ month: 3, day: 14, year: null });
  });

  it('accepts 29 February, because leap-day birthdays are real', () => {
    expect(makePartialDate(2, 29)).toEqual({ month: 2, day: 29, year: null });
  });

  it.each([
    [0, 10],
    [13, 10],
    [1, 0],
    [1, 32],
    [2, 30],
    [4, 31],
    [6, 31],
    [9, 31],
    [11, 31],
  ])('rejects month %i day %i', (month, day) => {
    expect(isValidMonthDay(month, day)).toBe(false);
    expect(() => makePartialDate(month, day)).toThrow();
  });

  it('rejects a year that cannot be a birth year', () => {
    expect(() => makePartialDate(3, 14, 1799)).toThrow();
    expect(() => makePartialDate(3, 14, 3000)).toThrow();
  });
});

describe('occurrenceInYear', () => {
  it('returns the plain date in a normal year', () => {
    expect(occurrenceInYear(makePartialDate(3, 14), 2026)).toEqual(at(2026, 3, 14));
  });

  it('returns 29 February in a leap year', () => {
    expect(occurrenceInYear(makePartialDate(2, 29), 2028)).toEqual(at(2028, 2, 29));
  });

  it('falls back to 28 February in a common year by default', () => {
    expect(occurrenceInYear(makePartialDate(2, 29), 2027)).toEqual(at(2027, 2, 28));
  });

  it('falls back to 1 March in a common year when the policy says so', () => {
    expect(occurrenceInYear(makePartialDate(2, 29), 2027, 'mar1')).toEqual(at(2027, 3, 1));
  });

  it('never silently produces a date in the wrong month', () => {
    // A naive `new Date(y, 1, 29)` rolls over to 1 March. Guard against that regressing.
    const d = occurrenceInYear(makePartialDate(2, 29), 2027);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });
});

describe('nextOccurrence', () => {
  const march14 = makePartialDate(3, 14, 1988);

  it('finds the birthday later this year', () => {
    expect(nextOccurrence(march14, at(2026, 1, 5))).toEqual(at(2026, 3, 14));
  });

  it('rolls over to next year once it has passed', () => {
    expect(nextOccurrence(march14, at(2026, 8, 9))).toEqual(at(2027, 3, 14));
  });

  it('counts today as the next occurrence — a birthday today has not passed', () => {
    expect(nextOccurrence(march14, at(2026, 3, 14))).toEqual(at(2026, 3, 14));
  });

  it('counts today even when the clock is late in the day', () => {
    const lateOnTheDay = new Date(2026, 2, 14, 23, 30);
    expect(nextOccurrence(march14, lateOnTheDay)).toEqual(at(2026, 3, 14));
  });

  it('handles the year boundary', () => {
    expect(nextOccurrence(makePartialDate(1, 1), at(2026, 12, 31))).toEqual(at(2027, 1, 1));
  });

  it('handles 31 December from 1 January', () => {
    expect(nextOccurrence(makePartialDate(12, 31), at(2026, 1, 1))).toEqual(at(2026, 12, 31));
  });

  it('works for a birthday with no year', () => {
    expect(nextOccurrence(makePartialDate(6, 2), at(2026, 8, 9))).toEqual(at(2027, 6, 2));
  });

  describe('leap day', () => {
    const feb29 = makePartialDate(2, 29, 2000);

    it('uses the real date in a leap year', () => {
      expect(nextOccurrence(feb29, at(2028, 1, 1))).toEqual(at(2028, 2, 29));
    });

    it('uses 28 February in a common year rather than skipping the year entirely', () => {
      expect(nextOccurrence(feb29, at(2026, 1, 1))).toEqual(at(2026, 2, 28));
    });

    it('does not fire twice in a leap year under the mar1 policy', () => {
      // 29 Feb 2028 exists, so the mar1 fallback must not also apply.
      expect(nextOccurrence(feb29, at(2028, 1, 1), 'mar1')).toEqual(at(2028, 2, 29));
    });

    it('rolls forward correctly the day after a fallback occurrence', () => {
      expect(nextOccurrence(feb29, at(2026, 3, 1))).toEqual(at(2027, 2, 28));
    });
  });
});

describe('daysUntil', () => {
  it('is 0 on the day itself', () => {
    expect(daysUntil(makePartialDate(3, 14), at(2026, 3, 14))).toBe(0);
  });

  it('counts whole days regardless of the time of day', () => {
    expect(daysUntil(makePartialDate(3, 14), new Date(2026, 2, 12, 23, 59))).toBe(2);
  });

  // These two only mean anything because the npm scripts pin TZ=Europe/London: local
  // midnights are 23 or 25 hours apart across a transition, and a floored ms/86400000
  // division silently loses a day. In a zone without DST both cases pass vacuously.
  it('does not drift when the clocks go forward', () => {
    // BST begins 29 March 2026, between these two dates.
    expect(daysUntil(makePartialDate(4, 5), at(2026, 3, 25))).toBe(11);
  });

  it('does not drift when the clocks go back', () => {
    // BST ends 25 October 2026, between these two dates.
    expect(daysUntil(makePartialDate(11, 5), at(2026, 10, 20))).toBe(16);
  });
});

describe('ageOn', () => {
  it('returns null when the birth year is unknown', () => {
    expect(ageOn(makePartialDate(3, 14), at(2026, 8, 9))).toBeNull();
  });

  it('counts a birthday already passed this year', () => {
    expect(ageOn(makePartialDate(3, 14, 1988), at(2026, 8, 9))).toBe(38);
  });

  it('does not count a birthday still to come this year', () => {
    expect(ageOn(makePartialDate(11, 20, 1988), at(2026, 8, 9))).toBe(37);
  });

  it('counts the birthday on the day itself', () => {
    expect(ageOn(makePartialDate(3, 14, 1988), at(2026, 3, 14))).toBe(38);
  });

  it('ages a leap-day person on their fallback date', () => {
    expect(ageOn(makePartialDate(2, 29, 2000), at(2026, 2, 28))).toBe(26);
    expect(ageOn(makePartialDate(2, 29, 2000), at(2026, 2, 27))).toBe(25);
  });
});

describe('ageAtNextOccurrence', () => {
  it('is the age they are about to turn', () => {
    expect(ageAtNextOccurrence(makePartialDate(11, 20, 1988), at(2026, 8, 9))).toBe(38);
  });

  it('is the age they turn today when the birthday is today', () => {
    expect(ageAtNextOccurrence(makePartialDate(3, 14, 1988), at(2026, 3, 14))).toBe(38);
  });

  it('is null without a birth year', () => {
    expect(ageAtNextOccurrence(makePartialDate(3, 14), at(2026, 8, 9))).toBeNull();
  });
});

describe('startOfDay', () => {
  it('strips the time without shifting the calendar day', () => {
    const d = startOfDay(new Date(2026, 7, 9, 23, 59, 59, 999));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(0);
  });
});
