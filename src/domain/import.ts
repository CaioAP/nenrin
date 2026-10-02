/**
 * The shape every acquisition source produces, and the logic that decides what to do with
 * one. Pure: no Expo, no database.
 *
 * This lives in the domain rather than beside the adapters because `partitionCandidates`
 * needs the type, and a domain module may not import from `src/sources/`.
 */

import type { PartialDate } from './birthday';
import type { PersonSource } from './person';

export type ImportCandidate = {
  /** The contact or event id this came from, for de-duplication across re-imports. */
  externalId: string;
  displayName: string;
  /**
   * Null means "ask the user" — either the source had no date, or it had one that is not a
   * real calendar day. The two are not worth distinguishing: both end in the same question.
   */
  birthday: PartialDate | null;
  source: PersonSource;
};

export type HandledExternalIds = {
  /** External ids already on a person row, soft-deleted ones included. */
  imported: ReadonlySet<string>;
  /** External ids the user explicitly refused. */
  skipped: ReadonlySet<string>;
  /** `identityKey` of every person already saved, whatever source they came from. */
  people: ReadonlySet<string>;
};

/**
 * Who a birthday belongs to, as far as an import can tell: a normalised name plus the day.
 *
 * External ids only de-duplicate re-reads of the *same* record. They cannot see that one
 * person was entered twice — `"Jaque's birthday"` and `"Jaque 💜∞'s birthday"` are distinct
 * calendar events, and the same Jaque may already be saved from contacts with a year. Each
 * would otherwise be dealt and saved as a new person.
 *
 * The name is case-folded, stripped of accents, and stripped of everything that is not a
 * letter or digit, so emoji and punctuation decorating a name do not make a second person.
 * The year is left out on purpose: one copy usually has it and the others do not, and
 * `13/06/1994` and `13/06` are the same birthday. Null when there is no birthday or the name
 * normalises to nothing — with no key, nothing is merged.
 */
export function identityKey(displayName: string, birthday: PartialDate | null): string | null {
  if (!birthday) return null;
  const name = displayName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (name === '') return null;
  return `${name}|${birthday.month}|${birthday.day}`;
}

/**
 * Why a candidate is not in the deck.
 *
 * The deck passes over both kinds identically; only the "ask me again" path distinguishes
 * them. The distinction is recorded at write time regardless, because it cannot be
 * reconstructed later: once rows exist without it, "not now" and "never" are
 * indistinguishable forever.
 */
export type SkipKind = 'deferred' | 'refused';

export type Partitioned = {
  /** Has a real birthday and has never been seen. What "import everything" imports. */
  ready: ImportCandidate[];
  /** No usable birthday, never seen. What the triage deck asks about. */
  needsBirthday: ImportCandidate[];
  /**
   * Already a person, explicitly refused, or another copy of someone in this scan. Dropped
   * without telling anyone.
   */
  alreadyKnown: ImportCandidate[];
};

/**
 * Splits a scan into what can be written, what must be asked about, and what to ignore.
 *
 * `Set` on both sides of `handled` rather than arrays: this is one membership test per
 * candidate, and an address book runs to four figures — arrays would make a single scan
 * quadratic.
 *
 * Already-known wins over the other two. A contact that was imported *and* later refused is
 * one candidate, not two, and appears once.
 *
 * A candidate whose `identityKey` matches a saved person is already known too, and so is a
 * second copy of the same key within one scan. Of two copies, the one carrying a year is
 * kept, since the year is the only thing they can disagree on.
 */
export function partitionCandidates(
  candidates: ImportCandidate[],
  handled: HandledExternalIds,
): Partitioned {
  const result: Partitioned = { ready: [], needsBirthday: [], alreadyKnown: [] };
  /** Index into `ready` of the copy kept for each key seen so far in this scan. */
  const kept = new Map<string, number>();

  for (const candidate of candidates) {
    const key = identityKey(candidate.displayName, candidate.birthday);
    if (
      handled.imported.has(candidate.externalId) ||
      handled.skipped.has(candidate.externalId) ||
      (key !== null && handled.people.has(key))
    ) {
      result.alreadyKnown.push(candidate);
    } else if (key !== null && kept.has(key)) {
      const index = kept.get(key) as number;
      const earlier = result.ready[index];
      if (earlier.birthday?.year == null && candidate.birthday?.year != null) {
        result.ready[index] = candidate;
        result.alreadyKnown.push(earlier);
      } else {
        result.alreadyKnown.push(candidate);
      }
    } else if (candidate.birthday) {
      if (key !== null) kept.set(key, result.ready.length);
      result.ready.push(candidate);
    } else {
      result.needsBirthday.push(candidate);
    }
  }

  return result;
}

/**
 * Which bucket the deck deals, per source. `manual` and `ask-link` never reach a deck.
 *
 * A function beside the partitioner rather than a flag inside it. `partitionCandidates` is
 * shared by every source and its bucket names each mean one thing; a `confirmAll` option
 * would push a per-source policy into it and make `ready` mean two things at once.
 *
 * The asymmetry is the point. Contacts arrive with names from the address book and dates the
 * user entered, so `ready` is safe to write in one tap and only `needsBirthday` needs asking
 * about. Calendar candidates arrive with a name parsed out of an event title and known
 * duplicates — `Pai's birthday` appears twice on the test device — so every one of them is
 * confirmed before anything is stored.
 */
export function cardsFor(source: PersonSource, partitioned: Partitioned): ImportCandidate[] {
  switch (source) {
    case 'contacts':
      return partitioned.needsBirthday;
    case 'calendar':
      return partitioned.ready;
    case 'manual':
    case 'ask-link':
      return [];
  }
}
