/**
 * Platform contact → `ImportCandidate`.
 *
 * Separate from `contacts.ts` on purpose. `expo-contacts` exposes a birthday two different
 * ways depending on platform, and that fork is the most defect-prone part of importing.
 * Here it takes plain objects and imports nothing from Expo at runtime — only types, which
 * are erased — so both platforms are testable on a machine that is neither.
 */

import type { ContactDetails } from 'expo-contacts';

import type { PartialDate } from '@/domain/birthday';
import { makePartialDate } from '@/domain/birthday';
import type { ImportCandidate } from '@/domain/import';

/**
 * A date as the device really sends it.
 *
 * The SDK types `ContactDate.year` as `year?: number`, so `null` is supposedly impossible.
 * The probe read `{"day":13,"month":4,"year":null}` off an Android phone. Where the platform
 * and its own types disagree, this boundary believes the platform — narrowing this back to
 * `number | undefined` on the strength of the SDK type would be a regression that typechecks.
 */
type ContactInputDate = { year?: number | null; month: number; day: number };

/**
 * The fields `contacts.ts` requests. Names are borrowed from `ContactDetails` so the two
 * cannot drift apart silently; the date-carrying fields are redeclared, because those are
 * exactly where the SDK's types are wrong.
 *
 * These are wider than what `getAllDetails` returns, which is the right direction: Task 5
 * passes a real `PartialContactDetails` straight into `mapContact`, and that call is what
 * proves the two still fit together. `id` on a date entry is optional here for the same
 * reason — the real `ExistingDate` always carries one, and nothing in this file reads it.
 */
export type ContactInput = { id: string } & Pick<
  ContactDetails,
  'fullName' | 'givenName' | 'familyName'
> & {
    birthday?: ContactInputDate | null;
    dates?: readonly { id?: string; label?: string; date?: ContactInputDate | null }[];
  };

/**
 * Observed on a device, not guessed. See the probe in `debug-tools.tsx` — an unmatched label
 * is indistinguishable from a contact with no birthday, so a wrong guess here fails silently
 * and forever.
 */
const BIRTHDAY_LABELS = new Set(['birthday']);

export function mapContact(contact: ContactInput): ImportCandidate | null {
  const displayName = displayNameOf(contact);
  if (!displayName) return null;

  return {
    externalId: contact.id,
    displayName,
    birthday: birthdayOf(contact),
    source: 'contacts',
  };
}

/**
 * A contact with no name is not a person you can wish a happy birthday — it is a loose phone
 * number. Dropping it here keeps it out of the triage deck rather than showing a blank card.
 */
function displayNameOf(contact: ContactInput): string | null {
  const composite = contact.fullName?.trim();
  if (composite) return composite;

  const assembled = [contact.givenName, contact.familyName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');

  return assembled || null;
}

/**
 * `makePartialDate` throws on a date that is not real, and contact databases accumulate junk
 * — one bad CSV import years ago is enough. An uncaught throw would take down an entire scan
 * over a single row, so an unusable date becomes "ask the user" instead.
 */
function birthdayOf(contact: ContactInput): PartialDate | null {
  const raw = contact.birthday ?? findBirthdayDate(contact);
  if (!raw) return null;

  try {
    return makePartialDate(raw.month, raw.day, raw.year);
  } catch {
    return null;
  }
}

function findBirthdayDate(contact: ContactInput): ContactInputDate | null | undefined {
  return contact.dates?.find(
    (entry) => entry.label !== undefined && BIRTHDAY_LABELS.has(entry.label.trim().toLowerCase()),
  )?.date;
}
