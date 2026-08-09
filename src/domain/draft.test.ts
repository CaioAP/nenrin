import { describe, expect, it } from 'vitest';

import { makePartialDate } from './birthday';
import { draftFromPerson, EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from './draft';

const THIS_YEAR = 2026;

const draft = (overrides: Partial<PersonDraft> = {}): PersonDraft => ({
  ...EMPTY_PERSON_DRAFT,
  displayName: 'Ana',
  month: 3,
  day: 14,
  ...overrides,
});

const errorsOf = (result: ReturnType<typeof parsePersonDraft>) => (result.ok ? {} : result.errors);

describe('parsePersonDraft', () => {
  it('accepts a name with a month and a day', () => {
    const result = parsePersonDraft(draft(), THIS_YEAR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.birthday).toEqual(makePartialDate(3, 14));
      expect(result.value.displayName).toBe('Ana');
      expect(result.value.notes).toBeNull();
    }
  });

  it('treats a blank year as unknown rather than as an error', () => {
    const result = parsePersonDraft(draft({ year: '' }), THIS_YEAR);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.birthday.year).toBeNull();
  });

  it('accepts a year when one is given', () => {
    const result = parsePersonDraft(draft({ year: '1988' }), THIS_YEAR);
    if (result.ok) expect(result.value.birthday.year).toBe(1988);
  });

  it('trims the name and turns blank notes into null', () => {
    const result = parsePersonDraft(draft({ displayName: '  Ana  ', notes: '   ' }), THIS_YEAR);
    if (result.ok) {
      expect(result.value.displayName).toBe('Ana');
      expect(result.value.notes).toBeNull();
    }
  });

  it('keeps real notes', () => {
    const result = parsePersonDraft(draft({ notes: ' allergic to cake ' }), THIS_YEAR);
    if (result.ok) expect(result.value.notes).toBe('allergic to cake');
  });

  it('accepts 29 February', () => {
    const result = parsePersonDraft(draft({ month: 2, day: 29 }), THIS_YEAR);
    expect(result.ok).toBe(true);
  });

  describe('rejections', () => {
    it('needs a name', () => {
      expect(errorsOf(parsePersonDraft(draft({ displayName: '   ' }), THIS_YEAR))).toHaveProperty(
        'displayName',
      );
    });

    it('needs a month and a day', () => {
      expect(errorsOf(parsePersonDraft(draft({ month: null }), THIS_YEAR))).toHaveProperty(
        'birthday',
      );
      expect(errorsOf(parsePersonDraft(draft({ day: null }), THIS_YEAR))).toHaveProperty(
        'birthday',
      );
    });

    it('rejects a day the month cannot hold', () => {
      expect(errorsOf(parsePersonDraft(draft({ month: 4, day: 31 }), THIS_YEAR))).toHaveProperty(
        'birthday',
      );
    });

    it('rejects a year in the future', () => {
      expect(errorsOf(parsePersonDraft(draft({ year: '2030' }), THIS_YEAR))).toHaveProperty('year');
    });

    it('accepts the current year — a baby born this year is not an error', () => {
      expect(parsePersonDraft(draft({ year: '2026' }), THIS_YEAR).ok).toBe(true);
    });

    it('rejects an implausibly distant year', () => {
      expect(errorsOf(parsePersonDraft(draft({ year: '1200' }), THIS_YEAR))).toHaveProperty('year');
    });

    it('reports every problem at once instead of one at a time', () => {
      // Fixing errors one per submit is the difference between a form and a fight.
      const errors = errorsOf(
        parsePersonDraft(
          { displayName: '', month: null, day: null, year: '2099', notes: '' },
          THIS_YEAR,
        ),
      );
      expect(Object.keys(errors).sort()).toEqual(['birthday', 'displayName', 'year']);
    });
  });
});

describe('draftFromPerson', () => {
  it('round-trips a person with a full birthday', () => {
    const original = { displayName: 'Ana', birthday: makePartialDate(3, 14, 1988), notes: 'cake' };
    const result = parsePersonDraft(draftFromPerson(original), THIS_YEAR);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(original);
  });

  it('round-trips a person with no year and no notes', () => {
    const original = { displayName: 'Bo', birthday: makePartialDate(6, 2), notes: null };
    const result = parsePersonDraft(draftFromPerson(original), THIS_YEAR);
    if (result.ok) expect(result.value).toEqual(original);
  });

  it('shows an unknown year as a blank field, not as "null"', () => {
    const populated = draftFromPerson({
      displayName: 'Bo',
      birthday: makePartialDate(6, 2),
      notes: null,
    });
    expect(populated.year).toBe('');
    expect(populated.notes).toBe('');
  });
});
