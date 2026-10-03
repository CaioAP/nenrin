import { describe, expect, it } from 'vitest';

import { partialDateFromAllDayStart } from './calendar-date';

/**
 * The Android assertions only mean something in a negative-offset zone.
 *
 * `npm run test:tz` pins TZ=America/Sao_Paulo (UTC−3) for exactly this block. Under
 * TZ=Europe/London the January case passes with local getters too — London is UTC+0 then —
 * so the suite that normally runs is blind to the bug this block exists to catch.
 */
describe('partialDateFromAllDayStart, Android (UTC midnight)', () => {
  it('reads UTC midnight as the calendar day it encodes', () => {
    // Local getters in São Paulo would say 24 January. Mãe's birthday is the 25th.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z', 'utc-midnight')).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('holds in the other half of the year, where London is UTC+1', () => {
    expect(partialDateFromAllDayStart('2027-07-15T00:00:00.000Z', 'utc-midnight')).toEqual({
      month: 7,
      day: 15,
      year: null,
    });
  });

  it('does not slip across a month boundary', () => {
    // The worst case: local getters turn this into 31 January.
    expect(partialDateFromAllDayStart('2027-02-01T00:00:00.000Z', 'utc-midnight')).toEqual({
      month: 2,
      day: 1,
      year: null,
    });
  });

  it('keeps 29 February, which is a real birthday', () => {
    expect(partialDateFromAllDayStart('2028-02-29T00:00:00.000Z', 'utc-midnight')).toEqual({
      month: 2,
      day: 29,
      year: null,
    });
  });

  it('accepts a Date as well as a string, because the SDK types say `string | Date`', () => {
    expect(
      partialDateFromAllDayStart(new Date('2027-01-25T00:00:00.000Z'), 'utc-midnight'),
    ).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('never fills in a year, however plausible the one on the wire looks', () => {
    // 2027 is the occurrence Android expanded, not the birth year. Storing it would claim
    // someone was born next year.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z', 'utc-midnight')?.year).toBeNull();
  });

  it('returns null for something that is not a date', () => {
    expect(partialDateFromAllDayStart('not a date', 'utc-midnight')).toBeNull();
    expect(partialDateFromAllDayStart('', 'utc-midnight')).toBeNull();
  });
});

/**
 * The iOS assertions only mean something in a positive-offset zone — the mirror image.
 *
 * Each instant is built the way EventKit builds it, local midnight in whatever zone the test
 * runs in, then serialized to a UTC ISO string the way `expo-calendar`'s Swift formatter does.
 * In São Paulo UTC getters happen to read that back correctly, so `npm run test:tz` is blind
 * here. The July cases are the ones that bite: London is UTC+1 then, local midnight on the
 * 15th is 23:00 UTC on the 14th, and `npm test` fails if the decoder reaches for UTC getters.
 */
describe('partialDateFromAllDayStart, iOS (local midnight)', () => {
  /** What `expo-calendar` hands over on iOS for an all-day event on this day. */
  const iosStart = (year: number, month: number, day: number) =>
    new Date(year, month - 1, day).toISOString();

  it('reads local midnight as the calendar day it encodes', () => {
    expect(partialDateFromAllDayStart(iosStart(2027, 7, 15), 'local-midnight')).toEqual({
      month: 7,
      day: 15,
      year: null,
    });
  });

  it('does not slip back across a month boundary', () => {
    // UTC getters in London's summer turn this into 31 July.
    expect(partialDateFromAllDayStart(iosStart(2027, 8, 1), 'local-midnight')).toEqual({
      month: 8,
      day: 1,
      year: null,
    });
  });

  it('keeps 29 February', () => {
    expect(partialDateFromAllDayStart(iosStart(2028, 2, 29), 'local-midnight')).toEqual({
      month: 2,
      day: 29,
      year: null,
    });
  });

  it('holds in winter too, where the zones that run the suite cannot tell', () => {
    expect(partialDateFromAllDayStart(iosStart(2027, 1, 25), 'local-midnight')).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('accepts a Date as well as a string', () => {
    expect(partialDateFromAllDayStart(new Date(2027, 6, 15), 'local-midnight')).toEqual({
      month: 7,
      day: 15,
      year: null,
    });
  });

  it('returns null for something that is not a date', () => {
    expect(partialDateFromAllDayStart('not a date', 'local-midnight')).toBeNull();
  });
});
