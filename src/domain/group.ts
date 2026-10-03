/**
 * Groups: named sets of people that carry defaults for their members.
 *
 * A group is how one decision covers forty people. "Work" says "remind me on the day" and
 * "Family" says "a week ahead", and nobody has to open forty people to say it. A group holds
 * two defaults — a lead time and a message tone — and both are *defaults*: a person's own
 * choice always wins, and a group with no opinion stays out of the way.
 *
 * Pure, like the rest of `src/domain/`. The lead-time fallback itself lives beside the person
 * in `resolveLeadDays`, because the scheduler was resolving through groups before groups had
 * a screen.
 */

import type { Tone } from './message';
import { resolveLeadDays } from './person';

export type Group = {
  id: string;
  name: string;
  /** Lead time for members with no override of their own. Null means no opinion. */
  leadDays: number | null;
  /** Message tone for members who never chose one. Null means no opinion. */
  tone: Tone | null;
  /** Everyone in the group, by person id. */
  memberIds: ReadonlySet<string>;
};

/**
 * The groups offered with one tap when they do not exist yet.
 *
 * Offered rather than created on install: a seeded group the user never asked for is one
 * more thing to delete, and these three are only the common case, not a taxonomy.
 */
export const SUGGESTED_GROUP_NAMES = ['Family', 'Work', 'School'] as const;

/** Long enough for "University friends", short enough to sit on a chip without wrapping. */
export const MAX_GROUP_NAME_LENGTH = 40;

/** The suggestions not already taken, compared the same way `parseGroupName` compares. */
export function suggestedGroupNames(existingNames: readonly string[]): string[] {
  const taken = new Set(existingNames.map(nameKey));
  return SUGGESTED_GROUP_NAMES.filter((name) => !taken.has(nameKey(name)));
}

export type GroupNameResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a typed group name.
 *
 * Inner whitespace is collapsed and case is ignored when checking for duplicates, because
 * "work" and "Work " side by side on the People tab are one group the user made twice, not
 * two groups. `ownName` is the group being renamed, so keeping a name — or fixing its
 * capitalisation — is not reported as a clash with itself.
 */
export function parseGroupName(
  raw: string,
  existingNames: readonly string[],
  ownName: string | null = null,
): GroupNameResult {
  const value = raw.trim().replace(/\s+/g, ' ');

  if (value === '') return { ok: false, error: 'A group needs a name.' };
  if (value.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_GROUP_NAME_LENGTH} characters.` };
  }

  const own = ownName === null ? null : nameKey(ownName);
  const clash = existingNames.find(
    (name) => nameKey(name) === nameKey(value) && own !== nameKey(name),
  );
  if (clash !== undefined) return { ok: false, error: `There is already a group called ${clash}.` };

  return { ok: true, value };
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * The tone a person's messages open on, or null when nothing decides it.
 *
 * The person's own choice first. Then their groups — but only when every group that has a
 * tone agrees. Someone in both "Family" and "Work" could be either, and picking one by rule
 * (the warmest, the first alphabetically) would be a guess presented as a decision; falling
 * through to the app default is the honest answer, and the tone chips are one tap away.
 *
 * Unlike lead times there is no "longest wins": lead times have a safe direction (too early
 * beats too late), tones do not.
 */
export function resolveTone(
  personTone: Tone | null,
  groupTones: readonly (Tone | null)[],
): Tone | null {
  if (personTone !== null) return personTone;

  const fromGroups = new Set(groupTones.filter((tone): tone is Tone => tone !== null));
  return fromGroups.size === 1 ? [...fromGroups][0] : null;
}

/**
 * Whether a change to someone's groups changes when they are reminded.
 *
 * The repository asks this before stamping a person as changed, because that stamp is what
 * `Schedulable.knownSince` reads — and a `knownSince` newer than a reminder's moment licenses
 * the scheduler to send it again. Joining a group with no lead time of its own, or one that
 * loses to a longer lead the person already inherits, must not touch the schedule at all.
 */
export function leadChanges(
  personLeadDays: number | null,
  groupLeadsBefore: readonly (number | null)[],
  groupLeadsAfter: readonly (number | null)[],
  defaultLeadDays: number,
): boolean {
  return (
    resolveLeadDays(personLeadDays, [...groupLeadsBefore], defaultLeadDays) !==
    resolveLeadDays(personLeadDays, [...groupLeadsAfter], defaultLeadDays)
  );
}

/** The groups a person belongs to, in the order given. */
export function groupsOf(personId: string, groups: readonly Group[]): Group[] {
  return groups.filter((group) => group.memberIds.has(personId));
}
