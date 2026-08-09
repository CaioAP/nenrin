import { describe, expect, it } from 'vitest';

import { makePartialDate } from './birthday';
import {
  formatBirthday,
  formatMonthDayShort,
  formatOccursOn,
  formatTurningAge,
  MONTH_NAMES,
} from './format';

describe('formatBirthday', () => {
  it('omits the year when it is unknown', () => {
    expect(formatBirthday(makePartialDate(3, 14))).toBe('14 March');
  });

  it('includes the year when it is known', () => {
    expect(formatBirthday(makePartialDate(3, 14, 1988))).toBe('14 March 1988');
  });

  it('formats every month without falling off the end of the array', () => {
    for (let month = 1; month <= 12; month++) {
      expect(formatBirthday(makePartialDate(month, 1))).not.toMatch(/undefined/);
    }
  });

  it('formats 29 February as itself, not as its fallback date', () => {
    // The stored birthday is the real one; the fallback only applies to occurrences.
    expect(formatBirthday(makePartialDate(2, 29))).toBe('29 February');
  });
});

describe('formatMonthDayShort', () => {
  it('abbreviates the month', () => {
    expect(formatMonthDayShort(makePartialDate(3, 14))).toBe('14 Mar');
  });

  it('never shows the year, however much is known', () => {
    expect(formatMonthDayShort(makePartialDate(9, 1, 1970))).toBe('1 Sep');
  });
});

describe('formatOccursOn', () => {
  it('leads with the weekday, which is the part worth knowing', () => {
    // 14 March 2026 is a Saturday.
    expect(formatOccursOn(new Date(2026, 2, 14))).toBe('Sat, 14 Mar');
  });

  it('handles a Sunday, the index-0 case', () => {
    // 1 March 2026 is a Sunday.
    expect(formatOccursOn(new Date(2026, 2, 1))).toBe('Sun, 1 Mar');
  });
});

describe('formatTurningAge', () => {
  it('phrases a known age', () => {
    expect(formatTurningAge(38)).toBe('turning 38');
  });

  it('returns null rather than an empty string when the year is unknown', () => {
    // An empty string would let a caller render "14 March · " with nothing after it.
    expect(formatTurningAge(null)).toBeNull();
  });

  it('handles a first birthday', () => {
    expect(formatTurningAge(1)).toBe('turning 1');
  });
});

describe('MONTH_NAMES', () => {
  it('has twelve months in order', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('January');
    expect(MONTH_NAMES[11]).toBe('December');
  });
});
