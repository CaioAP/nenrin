/**
 * The device address book as a birthday source.
 *
 * Deliberately thin. Everything that can be wrong — the platform birthday fork, impossible
 * dates, names — is in `map-contact.ts`, which is pure and tested. What is left is a
 * sequence of SDK calls with no branching of its own, which is why nothing here is unit
 * tested: mocking `expo-contacts` and asserting the mock was called proves nothing about a
 * device.
 */

import * as Contacts from 'expo-contacts';
import { Platform } from 'react-native';

import type { ImportCandidate } from '@/domain/import';
import { mapContact } from './map-contact';
import type { AccessLevel, BirthdaySource } from './types';

/**
 * The fields `ContactInput` declares — but the list is a platform fork, and getting this
 * wrong does not degrade gracefully.
 *
 * Android's native `ContactField` enum omits exactly two members the TypeScript enum
 * declares: `BIRTHDAY` and `NON_GREGORIAN_BIRTHDAY`. Requesting `BIRTHDAY` on Android does
 * not return an empty field — argument conversion fails and the whole `getAllDetails` call
 * rejects with `Couldn't convert 'birthday' to ContactField`, so **zero contacts are read**.
 * Observed on a device; `check`, `lint` and `expo export` all pass with the bug present.
 *
 * Android carries its birthday as a `dates` entry labelled `"birthday"` instead, which is
 * what `map-contact.ts` reads. The fork stops here — it must not reach the mapper, which is
 * pure precisely so both platforms are testable on a machine that is neither.
 */
const FIELDS = {
  ios: [
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.GIVEN_NAME,
    Contacts.ContactField.FAMILY_NAME,
    Contacts.ContactField.BIRTHDAY,
    Contacts.ContactField.DATES,
  ],
  android: [
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.GIVEN_NAME,
    Contacts.ContactField.FAMILY_NAME,
    Contacts.ContactField.DATES,
  ],
} as const;

export const contactsSource: BirthdaySource = {
  id: 'contacts',

  async isAvailable() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  },

  async requestAccess(): Promise<AccessLevel> {
    const permission = await Contacts.requestPermissionsAsync();
    if (!permission.granted) return 'none';
    // `accessPrivileges` is undefined on Android and pre-iOS-18 — the probe printed
    // "accessPrivileges: unknown" on a device where permission had just been granted.
    // Returning it raw would hand back `undefined` from a function typed `AccessLevel`:
    // tsc accepts it and every caller's switch falls through. A plain grant is full access.
    return permission.accessPrivileges ?? 'all';
  },

  /**
   * `getAllDetails` rather than `getAll`, because `getAll` returns full `Contact` instances
   * whose `getBirthday()` is a native call *per contact* — four hundred contacts would mean
   * four hundred bridge crossings to answer one question. This asks once.
   */
  async fetchCandidates(): Promise<ImportCandidate[]> {
    const contacts = await (Platform.OS === 'ios'
      ? Contacts.Contact.getAllDetails(FIELDS.ios)
      : Contacts.Contact.getAllDetails(FIELDS.android));

    return contacts
      .map((contact) => mapContact(contact))
      .filter((candidate): candidate is ImportCandidate => candidate !== null);
  },
};
