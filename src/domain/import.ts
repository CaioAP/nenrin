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
};

export type Partitioned = {
  /** Has a real birthday and has never been seen. What "import everything" imports. */
  ready: ImportCandidate[];
  /** No usable birthday, never seen. What the triage deck asks about. */
  needsBirthday: ImportCandidate[];
  /** Already a person, or explicitly refused. Dropped without telling anyone. */
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
 */
export function partitionCandidates(
  candidates: ImportCandidate[],
  handled: HandledExternalIds,
): Partitioned {
  const result: Partitioned = { ready: [], needsBirthday: [], alreadyKnown: [] };

  for (const candidate of candidates) {
    if (handled.imported.has(candidate.externalId) || handled.skipped.has(candidate.externalId)) {
      result.alreadyKnown.push(candidate);
    } else if (candidate.birthday) {
      result.ready.push(candidate);
    } else {
      result.needsBirthday.push(candidate);
    }
  }

  return result;
}
