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
