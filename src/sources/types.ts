/**
 * The interface every acquisition source implements.
 *
 * Shaped for its second implementor as much as its first: a calendar event has an id, a
 * title and a date, the same three things a contact has — the interface itself absorbed the
 * calendar source unchanged. The v2 ask-link is the third. But "adding a source is one new
 * file" is no longer true past two: the screen layer hardcodes the source→adapter mapping and
 * the per-source copy, so a third source also touches `src/domain/import.ts` (a new
 * `cardsFor` arm), `src/app/triage/index.tsx` (the source ternary and its copy ternaries), a
 * new section component, and `src/app/import.tsx`. The fix, when that third source arrives,
 * is a `Record<PersonSource, BirthdaySource>` registry that the screens read instead of
 * branching per source — not built now, since only two sources exist to shape it against.
 */

import type { ImportCandidate } from '@/domain/import';
import type { PersonSource } from '@/domain/person';

/**
 * Mirrors `expo-contacts`' own `accessPrivileges` rather than renaming it. `'limited'` is
 * iOS 18+, where the user grants access to a hand-picked subset — not an error and not a
 * degraded state, just a smaller address book.
 */
export type AccessLevel = 'all' | 'limited' | 'none';

export interface BirthdaySource {
  id: PersonSource;
  /** Whether this source can run here at all, before any permission is involved. */
  isAvailable(): Promise<boolean>;
  requestAccess(): Promise<AccessLevel>;
  /** Everything visible. De-duplication is the caller's job, via `partitionCandidates`. */
  fetchCandidates(): Promise<ImportCandidate[]>;
}
