import { describe, expect, it } from 'vitest';

import { type ContactInput, mapContact } from './map-contact';

const contact = (over: Partial<ContactInput> = {}): ContactInput => ({
  id: 'c1',
  fullName: 'Ana Paula Silva',
  givenName: 'Ana',
  familyName: 'Silva',
  birthday: null,
  dates: [],
  ...over,
});

describe('mapContact', () => {
  it('reads the iOS birthday field', () => {
    const result = mapContact(contact({ birthday: { month: 11, day: 25, year: 1988 } }));
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: 1988 });
  });

  it('reads an Android birthday out of the labelled dates list', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: 'birthday', date: { month: 11, day: 25 } }] }),
    );
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: null });
  });

  it('ignores dates that are not birthdays', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: 'anniversary', date: { month: 3, day: 2 } }] }),
    );
    expect(result?.birthday).toBeNull();
  });

  it('matches the label regardless of case or padding', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: '  Birthday ', date: { month: 3, day: 2 } }] }),
    );
    expect(result?.birthday).toEqual({ month: 3, day: 2, year: null });
  });

  it('prefers the birthday field when both are present', () => {
    const result = mapContact(
      contact({
        birthday: { month: 11, day: 25 },
        dates: [{ id: 'd1', label: 'birthday', date: { month: 1, day: 1 } }],
      }),
    );
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: null });
  });

  it('keeps a birthday with no year, which is the common case', () => {
    const result = mapContact(contact({ birthday: { month: 6, day: 8 } }));
    expect(result?.birthday).toEqual({ month: 6, day: 8, year: null });
  });

  it('normalises the explicit null year Android really sends', () => {
    // The SDK types `year?: number`, so a null is supposedly impossible. The device sends
    // one anyway — `{"day":13,"month":4,"year":null}`, straight off the probe. Asserted
    // here because a fixture built from the types alone would never cover the real shape.
    const result = mapContact(
      contact({
        dates: [{ id: 'd1', label: 'birthday', date: { month: 4, day: 13, year: null } }],
      }),
    );
    expect(result?.birthday).toEqual({ month: 4, day: 13, year: null });
  });

  it('asks the user rather than throwing when the phone holds an impossible date', () => {
    const result = mapContact(contact({ birthday: { month: 2, day: 30 } }));
    expect(result).not.toBeNull();
    expect(result?.birthday).toBeNull();
  });

  it('asks the user rather than throwing on an implausible year', () => {
    const result = mapContact(contact({ birthday: { month: 6, day: 8, year: 1650 } }));
    expect(result?.birthday).toBeNull();
  });

  it('carries the contact id and source through', () => {
    const result = mapContact(contact({ id: 'abc-123' }));
    expect(result).toMatchObject({ externalId: 'abc-123', source: 'contacts' });
  });

  it('falls back to given and family name when there is no composite name', () => {
    const result = mapContact(contact({ fullName: null }));
    expect(result?.displayName).toBe('Ana Silva');
  });

  it('drops a contact with no usable name, because there is nobody to wish', () => {
    expect(mapContact(contact({ fullName: null, givenName: null, familyName: null }))).toBeNull();
  });

  it('drops a contact whose name is only whitespace', () => {
    expect(mapContact(contact({ fullName: '   ', givenName: null, familyName: null }))).toBeNull();
  });
});
