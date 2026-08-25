/**
 * The interface every acquisition source implements. Adding a source is one new file.
 *
 * Shaped for its second implementor as much as its first: a calendar event has an id, a
 * title and a date, the same three things a contact has. The v2 ask-link is the third.
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
