# Contacts import — the source adapter

Step 5 of the implementation order in `docs/00-design.md`. Read that first; this spec
assumes its product thesis, in particular that work is ranked by
cost-per-birthday-acquired and that contacts import sits at the top of the funnel.

## Scope

This step builds the acquisition plumbing and **no product user interface**.

The one thing that renders is a `__DEV__` probe button described below, which cannot reach a
release build and exists to answer a question rather than to be used. No screen, route or
control that a user of the shipped app could ever reach is built here.

That is a deliberate choice. The triage deck is step 6 and is described in the design doc
as "the core UX bet — the screen worth polishing". Building it in the same change as
permission handling, de-duplication and a cross-platform field fork would mean tuning
gestures and debugging native access at the same time, with no way to tell which layer a
bad experience came from.

**In**

- `BirthdaySource`, the interface every acquisition source implements.
- A contacts adapter behind it, including the iOS limited-access path.
- A pure mapper from a platform contact to an `ImportCandidate`.
- A pure partitioner that splits candidates into what can be imported, what must be asked
  about, and what to ignore.
- Repository functions for the external ids the partitioner needs.
- A throwaway `__DEV__` probe that answers one question only a device can answer.
- `NSContactsUsageDescription` in `app.json`.

**Out, and where it lands instead**

- Every screen. Step 6.
- The triage deck itself. Step 6.
- The "import everything without reviewing it" escape hatch, and the warning shown before
  it runs. Step 6 — but see *Partitioning* below, which is what makes it buildable.
- Calendar import. Step 7, as the interface's second implementor.

## Module layout

```
src/domain/
  import.ts       ImportCandidate, partitionCandidates()     pure, tested

src/sources/
  types.ts        BirthdaySource, AccessLevel                pure types
  contacts.ts     expo-contacts calls, nothing else          device-only
  map-contact.ts  platform contact -> ImportCandidate        pure, tested

src/db/
  skipped.ts      listSkippedExternalIds(), skipContact()
  people.ts       + listExternalIdsBySource()
```

`ImportCandidate` is a domain type, not a source type. `partitionCandidates` needs it, and a
module in `src/domain/` may not import from `src/sources/` — putting the type beside the
adapters would invert the dependency the architecture rule exists to protect. Sources depend
on the domain; never the reverse.

The split between `contacts.ts` and `map-contact.ts` is the load-bearing decision here.

`expo-contacts` exposes a birthday two different ways depending on platform, so the mapper
contains a fork — the most defect-prone part of this step. Putting the fork in a module
that imports nothing from Expo makes it testable against fixture objects in plain Node.
Folding it into `contacts.ts` would make it reachable only from a device, which is the same
structural gap already recorded in `docs/01-deferred.md` for the `setTone` write path.

`map-contact.ts` sits in `src/sources/` rather than `src/domain/` because it knows the
shape of a platform contact. It imports no Expo *code* — only types, and only for the
argument it is handed. `src/domain/` stays free of any knowledge that contacts exist.

## The interface

```ts
// src/domain/import.ts
export type ImportCandidate = {
  externalId: string;
  displayName: string;
  /** Null means "ask the user" — no date, or a date the phone gave us that isn't real. */
  birthday: PartialDate | null;
  source: PersonSource;
};

// src/sources/types.ts
export interface BirthdaySource {
  id: PersonSource;
  isAvailable(): Promise<boolean>;
  requestAccess(): Promise<AccessLevel>;
  fetchCandidates(): Promise<ImportCandidate[]>;
}

/** Mirrors expo-contacts' `accessPrivileges`. 'limited' is iOS 18+ only. */
export type AccessLevel = 'all' | 'limited' | 'none';
```

Two corrections against the sketch in `docs/00-design.md`, which predates code that now
exists:

- `source` is `PersonSource` from `src/domain/person.ts`, not a re-declared union. That type
  already lists `'ask-link'`, so the v2 source needs no change here.
- `requestAccess()` returns `'all' | 'limited' | 'none'` rather than
  `'granted' | 'limited' | 'denied'`, matching `ContactsPermissionResponse.accessPrivileges`
  exactly. Renaming the platform's own vocabulary on the way through buys nothing and costs
  a translation table.

Calendar import is the second implementor and the interface is shaped for it without
bending: an event has an id, a title and a date, the same three things a contact has.

## Reading contacts

Use `Contact.getAllDetails(fields, options)`, which the SDK documents as *"an optimized
method for fetching bulk data; it avoids creating full Contact instances."*

The obvious alternative is wrong at this scale. `Contact.getAll()` returns full `Contact`
instances whose `getBirthday()` is an async native call *per contact* — an address book of
400 people would cross the bridge 400 times to answer one question. `getAllDetails` asks
once.

Fields requested: the contact id, the name, `birthday`, and `dates`.

### The platform fork

`getBirthday()` is annotated `@platform ios`. The SDK is explicit about the other side:
*"To set a birthday on Android, use the `addDate` method with the label 'birthday'."* So a
birthday arrives as a populated `birthday` field on iOS, and as an entry in `dates` carrying
some label on Android.

`ContactDate` needs no adaptation — its `year` is optional, documented as *"For birthday
dates, this field can be omitted to represent a date without a year"*, which is precisely
`PartialDate`.

### Open question, resolved on a device before the matcher is written

**What does Android actually put in `label`?**

The type is a bare `string`. The documentation offers `"birthday"` only as an example, and
says an absent label becomes `"other"`. Nothing states whether Android's
`ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY` normalises to a fixed English string
or to something locale-dependent — and the development device is a Brazilian Portuguese
Android phone, where a localised label is entirely plausible.

Guessing here fails silently and badly: an unmatched label makes a contact look like it has
no birthday, which is indistinguishable from a contact that genuinely has none. The user
would be asked to type a date their phone already knew.

So **the matcher is not specified in this document.** A probe lands first, reports what the
device really returns, and the matcher is written against that answer.

This is a sequencing constraint, not a task ordering preference. Implementation of
`map-contact.ts`'s Android branch is blocked until the probe has been run and its output
read.

### The probe

A button in the existing `DebugTools` panel that reads contacts and reports, verbatim, what
came back in `birthday` and in `dates` — labels included.

It reports only contacts that carry at least one date, since a contact with none says
nothing about labelling, and caps its output at the first 10 of them. The question is what
the strings look like, and ten samples answer that; dumping four hundred contacts into a
scrollable panel would bury the answer and put every name in the address book on screen.

`DebugTools` already describes itself as holding tools "for the three questions only a
device can answer", is `__DEV__`-gated so it cannot reach a release build, and is already
mounted in Settings. A fourth entry is in idiom.

The probe is throwaway. Whether it is deleted once the matcher is written, or kept because
re-running it on a second device is cheap, is a decision to be made at that point — not an
oversight if it is still there.

Android needs no new build to run it: `expo-contacts` contributes its permissions through
autolinked manifests and is already a dependency, so the existing development build has the
native module.

### Dates that are not real

`makePartialDate` throws a `RangeError` on an impossible month/day, and on a year outside
1800–2200. Contact databases accumulate junk — a bad CSV import years ago is enough — so an
uncaught throw mid-scan would take down an entire import over one bad row.

The mapper catches it and yields `birthday: null`.

The consequence is that the contact joins everything else with no usable date and gets asked
about in the triage deck. That is the right outcome: the phone's data was not trustworthy,
so a human is asked. The information that the phone specifically held nonsense is discarded
rather than surfaced in a fourth bucket, because nothing in v1 would consume it.

## Partitioning

```ts
export function partitionCandidates(
  candidates: ImportCandidate[],
  handled: { imported: ReadonlySet<string>; skipped: ReadonlySet<string> },
): {
  ready: ImportCandidate[];         // has a birthday, not seen before
  needsBirthday: ImportCandidate[]; // no usable birthday, not seen before
  alreadyKnown: ImportCandidate[];  // already a person, or explicitly refused
};
```

A pure function over plain objects. `Set` rather than array on both sides of `handled`,
because the whole point is a membership test per candidate — an array turns one scan into a
quadratic one on an address book that can run to four figures. No Expo, no database: the
database is read by the caller and handed in.

`alreadyKnown` wins over the other two. A candidate that is both already imported and
previously skipped lands there once, not in two buckets.

This is what keeps step 6 buildable. The user's requirement is that import defaults to
triage but offers an escape hatch that imports everything at once, behind a warning that
incomplete or unwanted data may be written. The three buckets are the answer to that:

- **`ready`** is exactly what the escape hatch imports. Nothing without a real date can be
  written, because `person.birth_month` and `birth_day` are `NOT NULL`.
- **`needsBirthday`** is exactly what the triage deck asks about.
- **`alreadyKnown`** is dropped without telling anyone. Re-running an import must not
  re-offer people already handled, which is the entire reason the `skipped` table exists.

Both affordances are built in step 6. They are recorded here because the partition shape is
chosen to serve them, and a later reader would otherwise have no idea why there are three
buckets rather than two.

### Where the sets come from

Both already have most of what they need:

- `person` carries `source` and `external_id` with an index on the pair, added for exactly
  this — the schema comments it as "Import checks 'have I already got this contact?' once
  per candidate."
- `skipped` exists, keyed on `(source, external_id)`, and is commented as being keyed that
  way "because the whole point is that no person row exists."

Missing: a repository function to list external ids for a source, and a `src/db/skipped.ts`
with a read and a write. `findByExternalId` already exists in `src/db/people.ts` but answers
a per-candidate question; one query returning a set beats N queries.

Soft deletes matter here. A person the user deleted has `deleted_at` set but still holds the
contact's external id. Import must not resurrect them — deleting someone and then importing
should not silently bring them back. `listExternalIdsBySource` therefore ignores
`deleted_at` and reports the id as taken regardless.

## iOS access

`requestPermissionsAsync()` returns `accessPrivileges`, which is `'limited'` on iOS 18+ when
the user has granted access to a hand-picked subset. `Contact.presentAccessPicker()` reopens
that picker so more contacts can be added to the selection.

The adapter reports the level and does nothing clever with it. Limited access is not an
error state and not a degraded one — `fetchCandidates()` returns whatever is visible, which
under limited access is the subset the user chose. The design doc is firm that the app must
be fully usable with contacts denied outright, and this step honours that by making denial a
value the caller receives rather than an exception it must catch.

Surfacing "you granted access to 3 contacts, tap to choose more" is step 6's job.

## `NSContactsUsageDescription`

Added to `app.json` in this step, and **unverified at the end of it**.

Android contributes its contacts permission through an autolinked manifest, so it needs no
configuration and the whole step is testable on the existing development build. iOS has no
equivalent: without the usage string the first access call crashes instead of prompting.
`AGENTS.md` already records this as a ship blocker.

The string is one line and costs nothing now. Left until an iOS build exists, it is
discovered by the crash. So it goes in now, and the spec records that no iOS device has
exercised it.

## Testing

Vitest reaches two modules, and they are deliberately the two where the defects live:

- **`map-contact.ts`** — fixtures shaped like iOS contacts and like Android contacts, in the
  same test file, so the fork is covered from both sides on a machine with neither platform.
  Includes the impossible-date case, asserting `birthday: null` rather than a throw.
- **`partitionCandidates`** — bucket assignment, including a candidate that is both already
  imported and skipped, and a soft-deleted person's external id counting as taken.

`contacts.ts` is not unit tested. It is a sequence of `expo-contacts` calls with no branching
of its own; testing it would mean mocking the SDK and asserting that the mock was called,
which proves nothing about a device. It is kept thin enough to read instead. If logic
accumulates there, that logic belongs in the mapper.

Beyond the suites, `npx expo export --platform android` must pass. `npm run check`,
`npm run lint` and `npm test` do not prove the app bundles.

## Device verification

Only a device can answer these.

1. The probe reports what `dates` and `label` contain on a pt-BR Android phone. **Blocks the
   Android matcher.**
2. With contacts permission granted, a scan produces candidates and the counts are plausible
   against a known address book.
3. With contacts permission denied, `requestAccess()` returns `'none'` and nothing throws.
4. A contact already imported does not reappear as `ready` on a second scan.

iOS limited access is not verifiable this step — no iOS build exists. It is written to the
documented API and carried into step 6's device pass.
