import { describe, expect, it } from 'vitest';

import { cardsFor, type ImportCandidate, identityKey, partitionCandidates } from './import';

const candidate = (over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  externalId: 'c1',
  displayName: 'Ana Paula',
  birthday: { month: 11, day: 25, year: null },
  source: 'contacts',
  ...over,
});

const nothingHandled = {
  imported: new Set<string>(),
  skipped: new Set<string>(),
  people: new Set<string>(),
};

describe('partitionCandidates', () => {
  it('puts a new contact with a birthday in ready', () => {
    const result = partitionCandidates([candidate()], nothingHandled);
    expect(result.ready).toHaveLength(1);
    expect(result.needsBirthday).toHaveLength(0);
    expect(result.alreadyKnown).toHaveLength(0);
  });

  it('puts a new contact without a birthday in needsBirthday', () => {
    const result = partitionCandidates([candidate({ birthday: null })], nothingHandled);
    expect(result.needsBirthday).toHaveLength(1);
    expect(result.ready).toHaveLength(0);
  });

  it('treats an already-imported contact as known', () => {
    const result = partitionCandidates([candidate({ externalId: 'c1' })], {
      imported: new Set(['c1']),
      skipped: new Set(),
      people: new Set(),
    });
    expect(result.alreadyKnown).toHaveLength(1);
    expect(result.ready).toHaveLength(0);
  });

  it('treats a refused contact as known, so triage never asks twice', () => {
    const result = partitionCandidates([candidate({ birthday: null })], {
      imported: new Set(),
      skipped: new Set(['c1']),
      people: new Set(),
    });
    expect(result.alreadyKnown).toHaveLength(1);
    expect(result.needsBirthday).toHaveLength(0);
  });

  it('counts a contact that is both imported and refused exactly once', () => {
    const result = partitionCandidates([candidate()], {
      imported: new Set(['c1']),
      skipped: new Set(['c1']),
      people: new Set(),
    });
    expect(result.alreadyKnown).toHaveLength(1);
    expect(result.ready).toHaveLength(0);
    expect(result.needsBirthday).toHaveLength(0);
  });

  it('keeps every candidate in exactly one bucket', () => {
    const candidates = [
      candidate({ externalId: 'a' }),
      candidate({ externalId: 'b', birthday: null }),
      candidate({ externalId: 'c' }),
    ];
    const result = partitionCandidates(candidates, {
      imported: new Set(['c']),
      skipped: new Set(),
      people: new Set(),
    });
    const total = result.ready.length + result.needsBirthday.length + result.alreadyKnown.length;
    expect(total).toBe(candidates.length);
  });

  it('preserves the order the source returned, in every bucket', () => {
    // All three, not just `ready`. The triage deck renders `needsBirthday` as a card stack,
    // so its order is what the user actually walks through — a bucket whose order is only
    // incidentally correct is one refactor away from shuffling the deck.
    const result = partitionCandidates(
      [
        candidate({ externalId: 'a', displayName: 'Ana' }),
        candidate({ externalId: 'known-1', displayName: 'Known One' }),
        candidate({ externalId: 'n1', displayName: 'No Date One', birthday: null }),
        candidate({ externalId: 'b', displayName: 'Bruno' }),
        candidate({ externalId: 'n2', displayName: 'No Date Two', birthday: null }),
        candidate({ externalId: 'known-2', displayName: 'Known Two' }),
      ],
      { imported: new Set(['known-1', 'known-2']), skipped: new Set(), people: new Set() },
    );
    expect(result.ready.map((c) => c.displayName)).toEqual(['Ana', 'Bruno']);
    expect(result.needsBirthday.map((c) => c.displayName)).toEqual(['No Date One', 'No Date Two']);
    expect(result.alreadyKnown.map((c) => c.displayName)).toEqual(['Known One', 'Known Two']);
  });

  it('handles an empty scan', () => {
    const result = partitionCandidates([], nothingHandled);
    expect(result).toEqual({ ready: [], needsBirthday: [], alreadyKnown: [] });
  });

  describe('the same person entered more than once', () => {
    const jaque = (externalId: string, displayName: string, year: number | null = null) =>
      candidate({
        externalId,
        displayName,
        birthday: { month: 6, day: 13, year },
        source: 'calendar',
      });

    it('deals one card for two events with the same name and day', () => {
      const result = partitionCandidates(
        [jaque('e1', 'Jaque'), jaque('e2', 'Jaque')],
        nothingHandled,
      );
      expect(result.ready.map((c) => c.externalId)).toEqual(['e1']);
      expect(result.alreadyKnown.map((c) => c.externalId)).toEqual(['e2']);
    });

    it('ignores emoji, case and accents decorating the name', () => {
      const result = partitionCandidates(
        [jaque('e1', 'Jaque'), jaque('e2', 'Jaque 💜∞'), jaque('e3', 'JAQUÉ')],
        nothingHandled,
      );
      expect(result.ready).toHaveLength(1);
      expect(result.alreadyKnown).toHaveLength(2);
    });

    it('drops a candidate matching a saved person, whatever the year', () => {
      const saved = identityKey('Jaque', { month: 6, day: 13, year: 1994 });
      const result = partitionCandidates([jaque('e1', 'Jaque 💜∞')], {
        ...nothingHandled,
        people: new Set([saved as string]),
      });
      expect(result.ready).toHaveLength(0);
      expect(result.alreadyKnown).toHaveLength(1);
    });

    it("keeps the copy that carries a year, in the first copy's place", () => {
      const result = partitionCandidates(
        [jaque('e1', 'Jaque'), candidate({ externalId: 'x' }), jaque('c1', 'Jaque', 1994)],
        nothingHandled,
      );
      expect(result.ready.map((c) => c.externalId)).toEqual(['c1', 'x']);
      expect(result.alreadyKnown.map((c) => c.externalId)).toEqual(['e1']);
    });

    it('keeps two people who share a name but not a birthday', () => {
      const result = partitionCandidates(
        [jaque('e1', 'Jaque'), candidate({ externalId: 'e2', displayName: 'Jaque' })],
        nothingHandled,
      );
      expect(result.ready).toHaveLength(2);
    });

    it('never merges candidates without a birthday', () => {
      const result = partitionCandidates(
        [
          candidate({ externalId: 'a', birthday: null }),
          candidate({ externalId: 'b', birthday: null }),
        ],
        nothingHandled,
      );
      expect(result.needsBirthday).toHaveLength(2);
    });
  });
});

describe('cardsFor', () => {
  const partitioned = {
    ready: [candidate({ externalId: 'r1', displayName: 'Has A Date' })],
    needsBirthday: [candidate({ externalId: 'n1', displayName: 'No Date', birthday: null })],
    alreadyKnown: [candidate({ externalId: 'k1', displayName: 'Known' })],
  };

  it('deals the contacts deck the candidates with no birthday', () => {
    expect(cardsFor('contacts', partitioned).map((c) => c.displayName)).toEqual(['No Date']);
  });

  it('deals the calendar deck the candidates that already have one', () => {
    // Not a contradiction of `ready`. `ready` means "has a date", not "import without
    // asking" — a calendar name is parsed out of free text and the duplicates are real, so
    // every one of them gets confirmed.
    expect(cardsFor('calendar', partitioned).map((c) => c.displayName)).toEqual(['Has A Date']);
  });

  it('never deals what is already known, from either source', () => {
    const dealt = [...cardsFor('contacts', partitioned), ...cardsFor('calendar', partitioned)];
    expect(dealt.map((c) => c.externalId)).not.toContain('k1');
  });

  it('returns nothing for the sources that have no deck', () => {
    // `manual` and `ask-link` are real members of PersonSource that no deck can be opened
    // for. Empty rather than a throw: honest about it without giving a screen a way to crash.
    expect(cardsFor('manual', partitioned)).toEqual([]);
    expect(cardsFor('ask-link', partitioned)).toEqual([]);
  });
});

describe('identityKey', () => {
  it('is null without a birthday, or when the name is only decoration', () => {
    expect(identityKey('Jaque', null)).toBeNull();
    expect(identityKey('💜∞', { month: 6, day: 13, year: null })).toBeNull();
  });

  it('collapses inner whitespace and punctuation', () => {
    expect(identityKey('  Ana   Paula! ', { month: 1, day: 2, year: null })).toBe(
      identityKey('ana paula', { month: 1, day: 2, year: 1990 }),
    );
  });
});
