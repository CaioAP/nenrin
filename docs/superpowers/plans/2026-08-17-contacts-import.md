# Contacts Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the contacts acquisition adapter and the pure logic around it, so a later step can put a triage deck on top of it.

**Architecture:** A thin, untested `src/sources/contacts.ts` makes the `expo-contacts` calls and nothing else. Everything that can be wrong — the iOS/Android birthday fork, impossible dates, de-duplication against people already imported or explicitly refused — lives in pure functions that run under Vitest with no device. A `__DEV__` probe answers one question the documentation cannot before the Android half of the mapper is written.

**Tech Stack:** TypeScript, `expo-contacts@57.0.3`, Drizzle + expo-sqlite, Vitest, Biome.

Spec: `docs/superpowers/specs/2026-08-17-contacts-import-design.md`

## Global Constraints

- **`src/domain/` imports nothing from Expo, React Native, or the database.** This is why `ImportCandidate` lives in `src/domain/import.ts` rather than in `src/sources/` — `partitionCandidates` needs the type, and a domain module must never import from `src/sources/`.
- **Every database write goes through a repository function in `src/db/`.** No screen touches the database directly.
- **Read the exact versioned Expo docs at https://docs.expo.dev/versions/v57.0.0/ before writing Expo code.** Do not write Expo APIs from memory.
- **`ContactDate.month` is documented as 1–12**, matching `PartialDate`. Task 1 confirms this on a real device before Task 2 relies on it.
- **Tests pin `TZ=Europe/London`** via the npm scripts. Nothing in this plan does date arithmetic, but do not bypass the scripts.
- Biome owns formatting and linting. There is no ESLint or Prettier. Run `npm run lint:fix` before committing if formatting drifts.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verification is `npm run check`, `npm run lint`, `npm test`, and `npx expo export --platform android --output-dir /tmp/nenrin-export`. The first three do not prove the app bundles.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/import.ts` (create) | `ImportCandidate` type; `partitionCandidates()`. Pure. |
| `src/domain/import.test.ts` (create) | Partition bucket assignment. |
| `src/sources/types.ts` (create) | `BirthdaySource`, `AccessLevel`. Types only. |
| `src/sources/map-contact.ts` (create) | Platform contact → `ImportCandidate`. Pure. Holds the iOS/Android fork. |
| `src/sources/map-contact.test.ts` (create) | Both platform shapes, impossible dates, nameless contacts. |
| `src/sources/contacts.ts` (create) | `expo-contacts` calls. Thin, untested. |
| `src/db/skipped.ts` (create) | Read and write the `skipped` table. |
| `src/db/people.ts` (modify) | Add `listExternalIdsBySource()`. |
| `src/components/debug-tools.tsx` (modify) | Add the `__DEV__` contacts probe. |
| `app.json` (modify) | Add `NSContactsUsageDescription`. |

---

### Task 1: The contacts probe

This task exists to answer questions the SDK types cannot, and it **blocks Task 2's Android branch**. Do not write the Android matcher before running this on a device and reading the output.

Three things it settles:

1. What Android puts in `dates[].label` for a birthday. The type is a bare `string`; the docs offer `"birthday"` only as an example; the test device is Brazilian Portuguese.
2. Whether `ContactDate.month` really is 1–12 rather than 0–11.
3. Whether importing `expo-contacts` at module scope is safe. `expo-notifications` crashes the whole app in Expo Go on Android at launch — see AGENTS.md — and this is the cheapest place to find out that contacts does not.

There is no unit test. The deliverable is output read off a phone.

**Files:**
- Modify: `src/components/debug-tools.tsx`
- Modify: `app.json`

**Interfaces:**
- Consumes: nothing.
- Produces: no code later tasks import. Produces the **observed label string** that Task 2's `BIRTHDAY_LABELS` is seeded with, and confirmation of month indexing.

- [ ] **Step 1: Add the iOS usage-description string**

`app.json`, inside the existing `ios` block, which currently holds only `bundleIdentifier`:

```json
    "ios": {
      "bundleIdentifier": "dev.caioalfonso.nenrin",
      "infoPlist": {
        "NSContactsUsageDescription": "Nenrin reads your contacts so it can find birthdays you have already saved, instead of asking you to type them in again."
      }
    },
```

Android needs nothing here — `expo-contacts` contributes its permission through an autolinked manifest. This string is added now because without it the first iOS access call crashes rather than prompting, and that is discovered by the crash. It is **not verified by this plan**; no iOS build exists.

- [ ] **Step 2: Confirm the config still resolves**

Run: `npx expo config --type prebuild`
Expected: exit code 0. A malformed `infoPlist` block fails here rather than at build time.

- [ ] **Step 3: Add the probe to the debug panel**

`src/components/debug-tools.tsx` already renders `ActionButton`s inside a `__DEV__`-gated panel and reports results through `setStatus`. Follow that shape exactly.

Add the import at the top of the file, alongside the existing ones:

```tsx
import * as Contacts from 'expo-contacts';
```

Add this function below `DebugPanel`:

```tsx
const PROBE_SAMPLE_LIMIT = 10;

/**
 * Dumps what the platform actually returns for birthdays, because the SDK types cannot say.
 *
 * `dates[].label` is typed as a bare string and documented with "birthday" only as an
 * example, so on Android there is no way to know from the docs whether the label is a fixed
 * English constant or the device locale's word. Guessing fails silently: an unmatched label
 * makes a contact look like it has no birthday, which is indistinguishable from one that
 * genuinely has none.
 *
 * Reports only contacts carrying at least one date — a contact with none says nothing about
 * labelling — and caps the sample, because the question is what the strings look like and
 * ten answers that as well as four hundred.
 */
async function probeContacts(): Promise<string> {
  const permission = await Contacts.requestPermissionsAsync();
  if (!permission.granted) {
    return `Permission not granted (accessPrivileges: ${permission.accessPrivileges ?? 'unknown'})`;
  }

  const contacts = await Contacts.Contact.getAllDetails([
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.BIRTHDAY,
    Contacts.ContactField.DATES,
  ]);

  const withDates = contacts.filter(
    (contact) => contact.birthday != null || (contact.dates?.length ?? 0) > 0,
  );

  const lines = withDates.slice(0, PROBE_SAMPLE_LIMIT).map((contact) => {
    const dates = (contact.dates ?? [])
      .map((entry) => `    label=${JSON.stringify(entry.label)} date=${JSON.stringify(entry.date)}`)
      .join('\n');
    return `${contact.fullName ?? '(no name)'}\n  birthday=${JSON.stringify(contact.birthday)}\n${dates}`;
  });

  return [
    `accessPrivileges: ${permission.accessPrivileges ?? 'unknown'}`,
    `${withDates.length} of ${contacts.length} contacts carry a date`,
    '',
    ...lines,
  ].join('\n');
}
```

- [ ] **Step 4: Wire the button**

`DebugPanel` already has a `run(label, task)` helper that sets `busy`, shows a progress label, catches, and clears — use it rather than hand-rolling any of that. Add this alongside the existing buttons in the returned JSX:

```tsx
<ActionButton
  label="Probe contacts"
  disabled={busy}
  onPress={() => run('Probing', probeContacts)}
/>
```

`ActionButton` takes exactly `{ label, onPress, disabled }`. `run` already turns a thrown error into the status line, so `probeContacts` may throw freely.

- [ ] **Step 5: Verify it compiles and bundles**

Run: `npm run check && npm run lint`
Expected: both clean.

Run: `npx expo export --platform android --output-dir /tmp/nenrin-export`
Expected: exit 0.

This proves the module resolves and bundles. It does **not** prove the module-scope import is safe — AGENTS.md records that `check`, `lint`, `test` and `expo export` all passed while the analogous `expo-notifications` import was crashing the app at launch. Only Step 7 on a real device answers that.

- [ ] **Step 6: Commit**

```bash
git add src/components/debug-tools.tsx app.json
git commit -m "$(cat <<'EOF'
feat(debug): probe what contacts actually return

Android stores a birthday as a labelled entry in `dates`, and the label is
typed as a bare string with "birthday" given only as an example. Nothing in
the docs says whether it is a fixed constant or the device locale's word,
and the test phone is pt-BR. Guessing fails silently — an unmatched label
makes a contact look like it has no birthday at all.

Also confirms ContactDate months are 1-12 rather than 0-11, and that
importing expo-contacts at module scope does not do to the app what
expo-notifications does in Expo Go.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: DEVICE GATE — run it and record the answer**

Start the dev client, open Settings, tap **Probe contacts**, and read the output. Write down:

- the exact `label` string on birthday entries;
- whether `birthday` is populated (expected: iOS yes, Android null);
- the `month` value for a contact whose birthday you know, confirming 1–12.

**Do not start Task 2 until this output exists.** If the label is not `"birthday"`, Task 2 Step 3's `BIRTHDAY_LABELS` is seeded with what the device reported instead.

---

### Task 2: The candidate type and the mapper

**Files:**
- Create: `src/domain/import.ts`
- Create: `src/sources/map-contact.ts`
- Create: `src/sources/map-contact.test.ts`

**Interfaces:**
- Consumes: the observed label string from Task 1.
- Produces:
  - `ImportCandidate` = `{ externalId: string; displayName: string; birthday: PartialDate | null; source: PersonSource }` from `@/domain/import`.
  - `mapContact(contact: ContactInput): ImportCandidate | null` from `@/sources/map-contact`.
  - `ContactInput` = `{ id: string } & Pick<ContactDetails, 'fullName' | 'givenName' | 'familyName' | 'birthday' | 'dates'>` from `@/sources/map-contact`.

- [ ] **Step 1: Create the candidate type**

`src/domain/import.ts`:

```ts
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
```

Check `src/domain/birthday.ts` exports `PartialDate` as a type before relying on this import.

- [ ] **Step 2: Write the failing tests**

`src/sources/map-contact.test.ts`. These fixtures are plain objects — no Expo module is loaded at runtime, because `ContactDetails` is imported as a *type* only.

```ts
import { describe, expect, it } from 'vitest';

import { type ContactInput, mapContact } from './map-contact';

const contact = (over: Partial<ContactInput> = {}): ContactInput => ({
  id: 'c1',
  fullName: 'Ana Paula Silva',
  givenName: 'Ana',
  familyName: 'Silva',
  birthday: null,
  dates: [],
  ...over,
});

describe('mapContact', () => {
  it('reads the iOS birthday field', () => {
    const result = mapContact(contact({ birthday: { month: 11, day: 25, year: 1988 } }));
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: 1988 });
  });

  it('reads an Android birthday out of the labelled dates list', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: 'birthday', date: { month: 11, day: 25 } }] }),
    );
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: null });
  });

  it('ignores dates that are not birthdays', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: 'anniversary', date: { month: 3, day: 2 } }] }),
    );
    expect(result?.birthday).toBeNull();
  });

  it('matches the label regardless of case or padding', () => {
    const result = mapContact(
      contact({ dates: [{ id: 'd1', label: '  Birthday ', date: { month: 3, day: 2 } }] }),
    );
    expect(result?.birthday).toEqual({ month: 3, day: 2, year: null });
  });

  it('prefers the birthday field when both are present', () => {
    const result = mapContact(
      contact({
        birthday: { month: 11, day: 25 },
        dates: [{ id: 'd1', label: 'birthday', date: { month: 1, day: 1 } }],
      }),
    );
    expect(result?.birthday).toEqual({ month: 11, day: 25, year: null });
  });

  it('keeps a birthday with no year, which is the common case', () => {
    const result = mapContact(contact({ birthday: { month: 6, day: 8 } }));
    expect(result?.birthday).toEqual({ month: 6, day: 8, year: null });
  });

  it('asks the user rather than throwing when the phone holds an impossible date', () => {
    const result = mapContact(contact({ birthday: { month: 2, day: 30 } }));
    expect(result).not.toBeNull();
    expect(result?.birthday).toBeNull();
  });

  it('asks the user rather than throwing on an implausible year', () => {
    const result = mapContact(contact({ birthday: { month: 6, day: 8, year: 1650 } }));
    expect(result?.birthday).toBeNull();
  });

  it('carries the contact id and source through', () => {
    const result = mapContact(contact({ id: 'abc-123' }));
    expect(result).toMatchObject({ externalId: 'abc-123', source: 'contacts' });
  });

  it('falls back to given and family name when there is no composite name', () => {
    const result = mapContact(contact({ fullName: null }));
    expect(result?.displayName).toBe('Ana Silva');
  });

  it('drops a contact with no usable name, because there is nobody to wish', () => {
    expect(mapContact(contact({ fullName: null, givenName: null, familyName: null }))).toBeNull();
  });

  it('drops a contact whose name is only whitespace', () => {
    expect(mapContact(contact({ fullName: '   ', givenName: null, familyName: null }))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- map-contact`
Expected: FAIL — cannot resolve `./map-contact`.

- [ ] **Step 4: Write the mapper**

`src/sources/map-contact.ts`. **Before writing `BIRTHDAY_LABELS`, use the label Task 1 observed.** If the device reported something other than `"birthday"`, that string goes in the set. Do not add locale strings you have not seen on a device — an unverified guess is the thing this design deliberately avoided.

```ts
/**
 * Platform contact → `ImportCandidate`.
 *
 * Separate from `contacts.ts` on purpose. `expo-contacts` exposes a birthday two different
 * ways depending on platform, and that fork is the most defect-prone part of importing.
 * Here it takes plain objects and imports nothing from Expo at runtime — only types, which
 * are erased — so both platforms are testable on a machine that is neither.
 */

import type { ContactDate, ContactDetails } from 'expo-contacts';

import type { PartialDate } from '@/domain/birthday';
import { makePartialDate } from '@/domain/birthday';
import type { ImportCandidate } from '@/domain/import';

/** Exactly the fields `contacts.ts` requests, so the two cannot drift apart silently. */
export type ContactInput = { id: string } & Pick<
  ContactDetails,
  'fullName' | 'givenName' | 'familyName' | 'birthday' | 'dates'
>;

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
  const raw: ContactDate | undefined = contact.birthday ?? findBirthdayDate(contact);
  if (!raw) return null;

  try {
    return makePartialDate(raw.month, raw.day, raw.year);
  } catch {
    return null;
  }
}

function findBirthdayDate(contact: ContactInput): ContactDate | undefined {
  return contact.dates?.find(
    (entry) => entry.label !== undefined && BIRTHDAY_LABELS.has(entry.label.trim().toLowerCase()),
  )?.date;
}
```

`contact.birthday` is typed `ContactDate | null`, so `??` falls through on null. Confirm that against the installed types if the compiler disagrees.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- map-contact`
Expected: PASS, all 12.

Run: `npm run check && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/domain/import.ts src/sources/map-contact.ts src/sources/map-contact.test.ts
git commit -m "$(cat <<'EOF'
feat(sources): map a platform contact to an import candidate

The iOS/Android birthday fork is the most defect-prone part of importing, so
it lives in a module that imports Expo types only. Both platform shapes are
covered by fixtures on a machine that is neither.

An impossible date becomes null rather than an exception: makePartialDate
throws, contact databases hold junk, and one bad row must not take down a
scan of four hundred. The contact still surfaces — the user gets asked,
which is the right answer when the phone's data cannot be trusted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Partitioning candidates

**Files:**
- Modify: `src/domain/import.ts`
- Create: `src/domain/import.test.ts`

**Interfaces:**
- Consumes: `ImportCandidate` from Task 2.
- Produces: `partitionCandidates(candidates, handled)` from `@/domain/import`, returning `{ ready, needsBirthday, alreadyKnown }`, each an `ImportCandidate[]`.

- [ ] **Step 1: Write the failing tests**

`src/domain/import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { type ImportCandidate, partitionCandidates } from './import';

const candidate = (over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  externalId: 'c1',
  displayName: 'Ana Paula',
  birthday: { month: 11, day: 25, year: null },
  source: 'contacts',
  ...over,
});

const nothingHandled = { imported: new Set<string>(), skipped: new Set<string>() };

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
    });
    expect(result.alreadyKnown).toHaveLength(1);
    expect(result.ready).toHaveLength(0);
  });

  it('treats a refused contact as known, so triage never asks twice', () => {
    const result = partitionCandidates([candidate({ birthday: null })], {
      imported: new Set(),
      skipped: new Set(['c1']),
    });
    expect(result.alreadyKnown).toHaveLength(1);
    expect(result.needsBirthday).toHaveLength(0);
  });

  it('counts a contact that is both imported and refused exactly once', () => {
    const result = partitionCandidates([candidate()], {
      imported: new Set(['c1']),
      skipped: new Set(['c1']),
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
    });
    const total = result.ready.length + result.needsBirthday.length + result.alreadyKnown.length;
    expect(total).toBe(candidates.length);
  });

  it('preserves the order the source returned', () => {
    const result = partitionCandidates(
      [candidate({ externalId: 'a', displayName: 'Ana' }), candidate({ externalId: 'b', displayName: 'Bruno' })],
      nothingHandled,
    );
    expect(result.ready.map((c) => c.displayName)).toEqual(['Ana', 'Bruno']);
  });

  it('handles an empty scan', () => {
    const result = partitionCandidates([], nothingHandled);
    expect(result).toEqual({ ready: [], needsBirthday: [], alreadyKnown: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- domain/import`
Expected: FAIL — `partitionCandidates` is not exported.

- [ ] **Step 3: Implement the partitioner**

Append to `src/domain/import.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- domain/import`
Expected: PASS, all 8.

Run: `npm test`
Expected: the full suite green — 207 existing plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/domain/import.ts src/domain/import.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): partition a scan into ready, needs-birthday and known

Three buckets rather than two because step 6 needs both affordances: ready
is exactly what an "import everything" escape hatch may write, since
birth_month and birth_day are NOT NULL and nothing without a date can
become a person; needs-birthday is exactly what the triage deck asks about.

Sets rather than arrays on the handled ids — one membership test per
candidate against an address book in the thousands.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The external-id repositories

**Files:**
- Modify: `src/db/people.ts`
- Create: `src/db/skipped.ts`

**Interfaces:**
- Consumes: `PersonSource` from `@/domain/person`.
- Produces:
  - `listExternalIdsBySource(source: PersonSource): Promise<Set<string>>` from `@/db/people`.
  - `listSkippedExternalIds(source: PersonSource): Promise<Set<string>>` from `@/db/skipped`.
  - `skipContact(source: PersonSource, externalId: string): Promise<void>` from `@/db/skipped`.

No unit tests. `src/db/client.ts` calls `openDatabaseSync` at module scope, so importing anything from `src/db/` needs a device — the same structural limit already recorded in `docs/01-deferred.md`. These functions are deliberately branch-free so there is nothing to test but the query itself, which only a device can answer.

- [ ] **Step 1: Add the person-side lookup**

Append to `src/db/people.ts`, directly below the existing `findByExternalId`, whose docblock already establishes the soft-delete rule this follows:

```ts
/**
 * Every external id this source has already produced a person for.
 *
 * One query instead of one per candidate — `findByExternalId` answers the same question for
 * a single contact, which is the wrong shape for a scan of hundreds.
 *
 * Soft-deleted rows count, exactly as they do in `findByExternalId`: someone the user
 * deleted must not quietly return the next time they import their address book.
 */
export async function listExternalIdsBySource(source: PersonSource): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: person.externalId })
    .from(person)
    .where(eq(person.source, source));

  return new Set(
    rows.map((row) => row.externalId).filter((id): id is string => id !== null),
  );
}
```

`eq` is already imported in this file. Add `PersonSource` to the existing `@/domain/person` import — it currently imports `{ type Person, resolveLeadDays }`.

- [ ] **Step 2: Create the skipped repository**

`src/db/skipped.ts`:

```ts
/**
 * The contacts the user refused, so the triage deck never asks about them twice.
 *
 * Keyed on source and external id rather than on a person, because the whole point is that
 * no person row exists — see the table's own comment in `schema.ts`. Without this, every
 * re-import replays the entire address book.
 */

import { eq } from 'drizzle-orm';

import type { PersonSource } from '@/domain/person';
import { db } from './client';
import { skipped } from './schema';

/** Every external id from this source that the user has told us to stop asking about. */
export async function listSkippedExternalIds(source: PersonSource): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: skipped.externalId })
    .from(skipped)
    .where(eq(skipped.source, source));

  return new Set(rows.map((row) => row.externalId));
}

/**
 * Records a refusal. Idempotent — tapping "don't ask again" on a contact already refused is
 * not an error, and the primary key is the source/id pair.
 */
export async function skipContact(source: PersonSource, externalId: string): Promise<void> {
  await db.insert(skipped).values({ source, externalId }).onConflictDoNothing();
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run check && npm run lint`
Expected: both clean. If `onConflictDoNothing` is not available on this Drizzle version, check the installed `drizzle-orm` sqlite builder API rather than substituting a read-then-write, which races.

Run: `npm test`
Expected: still green — nothing here is imported by a test.

- [ ] **Step 4: Commit**

```bash
git add src/db/people.ts src/db/skipped.ts
git commit -m "$(cat <<'EOF'
feat(db): read the external ids an import must skip

Two sets, one query each: people already imported from a source, and
contacts the user refused. The scan needs membership tests, not a row.

Soft-deleted people still count as taken, matching findByExternalId — a
person the user deleted must not reappear on the next import.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The adapter

**Files:**
- Create: `src/sources/types.ts`
- Create: `src/sources/contacts.ts`

**Interfaces:**
- Consumes: `mapContact`, `ContactInput` from Task 2; `ImportCandidate` from Task 2.
- Produces:
  - `BirthdaySource`, `AccessLevel` from `@/sources/types`.
  - `contactsSource: BirthdaySource` from `@/sources/contacts`.

- [ ] **Step 1: Define the interface**

`src/sources/types.ts`:

```ts
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
```

- [ ] **Step 2: Implement the contacts adapter**

`src/sources/contacts.ts`:

```ts
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
import { type ContactInput, mapContact } from './map-contact';
import type { AccessLevel, BirthdaySource } from './types';

/**
 * Exactly the fields `ContactInput` declares. Asking for less would leave a field undefined
 * at runtime that the type says is present.
 */
const FIELDS = [
  Contacts.ContactField.FULL_NAME,
  Contacts.ContactField.GIVEN_NAME,
  Contacts.ContactField.FAMILY_NAME,
  Contacts.ContactField.BIRTHDAY,
  Contacts.ContactField.DATES,
] as const;

export const contactsSource: BirthdaySource = {
  id: 'contacts',

  async isAvailable() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  },

  async requestAccess(): Promise<AccessLevel> {
    const permission = await Contacts.requestPermissionsAsync();
    if (!permission.granted) return 'none';
    // Pre-iOS-18 and Android report no privileges at all; a plain grant is full access.
    return permission.accessPrivileges ?? 'all';
  },

  /**
   * `getAllDetails` rather than `getAll`, because `getAll` returns full `Contact` instances
   * whose `getBirthday()` is a native call *per contact* — four hundred contacts would mean
   * four hundred bridge crossings to answer one question. This asks once.
   */
  async fetchCandidates(): Promise<ImportCandidate[]> {
    const contacts = await Contacts.Contact.getAllDetails(FIELDS);

    return contacts
      .map((contact) => mapContact(contact as ContactInput))
      .filter((candidate): candidate is ImportCandidate => candidate !== null);
  },
};
```

If `getAllDetails`'s return type already satisfies `ContactInput`, drop the `as ContactInput` cast — it is there only because `PartialContactDetails` is a mapped type over the exact tuple passed, and the compiler may or may not narrow it. Prefer no cast if `npm run check` passes without one.

- [ ] **Step 3: Verify it compiles and bundles**

Run: `npm run check && npm run lint`
Expected: both clean.

Run: `npm test`
Expected: full suite green.

Run: `npx expo export --platform android --output-dir /tmp/nenrin-export`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/sources/types.ts src/sources/contacts.ts
git commit -m "$(cat <<'EOF'
feat(sources): read birthdays out of the device address book

First implementor of BirthdaySource, which is shaped for its second: a
calendar event has an id, a title and a date, the same three things a
contact has.

getAllDetails rather than getAll — the latter returns full Contact
instances whose getBirthday() is a native call each, so an address book of
four hundred would cross the bridge four hundred times to answer one
question.

Limited access is reported, not treated as failure. On iOS 18 it means the
user picked a subset, which is a smaller address book rather than an error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Device verification

No code. The checks only a device can answer, from the spec's verification section. Run on Android against the existing development build.

- [ ] **Check 1: A scan produces plausible candidates**

Temporarily call `contactsSource.requestAccess()` then `contactsSource.fetchCandidates()` from the debug panel and report `length` plus the first few names. Compare against an address book you know. Remove the temporary button afterwards, or keep it — it is `__DEV__` only.

- [ ] **Check 2: Denial is a value, not a crash**

Revoke contacts permission in Android settings, relaunch, run the scan. Expected: `requestAccess()` returns `'none'` and nothing throws. The design doc requires the app stay fully usable with contacts denied.

- [ ] **Check 3: Birthdays actually come through**

At least one contact you know has a birthday appears with a non-null `birthday` and the right month and day. This is the check that catches a wrong `BIRTHDAY_LABELS` — if every candidate comes back with a null birthday on Android, the label is not what Task 1 recorded.

- [ ] **Check 4: The probe's finding is still true**

If Task 1 was run days earlier, confirm the label has not changed after any contacts-app update.

- [ ] **Check 5: The de-dup sets read**

The spec's fourth device check — "a contact already imported does not reappear as `ready` on a second scan" — **cannot be fully run in this step**, because nothing here writes a person. Import is step 6's job.

What is runnable now: call `listExternalIdsBySource('contacts')` and `listSkippedExternalIds('contacts')` from the debug panel and confirm both return an empty `Set` without throwing. That proves the queries and the `Set` conversion work against the real schema, which is the part a device is needed for.

The end-to-end claim — import, rescan, contact does not return — is carried into step 6's device pass, where a person can actually be written. Record it there rather than treating it as done here.

- [ ] **Step 5: Record the results and decide the probe's fate**

Append the outcomes to the plan or the spec, and decide whether the probe stays in `DebugTools`. Keeping it is defensible — re-running it on a second device is cheap. Deleting it is also defensible. Either way it is a decision, not an oversight.

---

## Not in this plan

Recorded so they are not mistaken for omissions:

- **Every screen.** The import UI, the triage deck, the "import everything" escape hatch and its data-quality warning are step 6. `partitionCandidates` returns three buckets specifically so both affordances are buildable then.
- **Writing people.** Nothing here calls `createPerson`. A scan produces candidates; committing them is step 6's job.
- **Calendar import.** Step 7, as `BirthdaySource`'s second implementor.
- **iOS verification.** No iOS build exists. `NSContactsUsageDescription` is added in Task 1 and is unverified at the end of this plan; `presentAccessPicker` is written to the documented API and carried into step 6's device pass.
