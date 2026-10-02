import { describe, expect, it } from 'vitest';

import { partialDateFromAllDayStart } from './calendar-date';

/**
 * These assertions only mean something in a negative-offset zone.
 *
 * `npm run test:tz` pins TZ=America/Sao_Paulo (UTC−3) for exactly this file. Under
 * TZ=Europe/London the January case passes with local getters too — London is UTC+0 then —
 * so the suite that normally runs is blind to the bug this file exists to catch.
 */
describe('partialDateFromAllDayStart', () => {
  it('reads UTC midnight as the calendar day it encodes', () => {
    // Local getters in São Paulo would say 24 January. Mãe's birthday is the 25th.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z')).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('holds in the other half of the year, where London is UTC+1', () => {
    expect(partialDateFromAllDayStart('2027-07-15T00:00:00.000Z')).toEqual({
      month: 7,
      day: 15,
      year: null,
    });
  });

  it('does not slip across a month boundary', () => {
    // The worst case: local getters turn this into 31 January.
    expect(partialDateFromAllDayStart('2027-02-01T00:00:00.000Z')).toEqual({
      month: 2,
      day: 1,
      year: null,
    });
  });

  it('keeps 29 February, which is a real birthday', () => {
    expect(partialDateFromAllDayStart('2028-02-29T00:00:00.000Z')).toEqual({
      month: 2,
      day: 29,
      year: null,
    });
  });

  it('accepts a Date as well as a string, because the SDK types say `string | Date`', () => {
    expect(partialDateFromAllDayStart(new Date('2027-01-25T00:00:00.000Z'))).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('never fills in a year, however plausible the one on the wire looks', () => {
    // 2027 is the occurrence Android expanded, not the birth year. Storing it would claim
    // someone was born next year.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z')?.year).toBeNull();
  });

  it('returns null for something that is not a date', () => {
    expect(partialDateFromAllDayStart('not a date')).toBeNull();
    expect(partialDateFromAllDayStart('')).toBeNull();
  });
});
