# Calendar import — design

Step 7 of the acquisition funnel. Reads birthdays out of the device's calendars and deals
them through the deck built in step 6.

Branched from `main` as `feat/calendar-import`, which already carries the device probe and
the measurement this design rests on.

## Why this exists

`docs/00-design.md` ranks sources by cost-per-birthday-acquired and put contacts first. On the
development device that ranking is wrong:

| Source | Read | Birthdays |
|---|---|---|
| Contacts | 433 contacts | 2 |
| Device calendars | 89 events, one year forward | ~10 (12 matches, duplicates included) |

Mãe, Pai, Breno, Luan and Jaque are in Google Calendar and not in the address book. Calendar
import is not a nice-to-have behind contacts import — on this phone it is **the** source.

**It took three probe runs to see that, and the reason is the most important constraint
below.** The first two reported zero. See *The visibility trap*.

## Decisions

Each was chosen over a named alternative. The alternative is recorded because the reason is
not recoverable from the code.

### The name is parsed out of the title, with the whole title as fallback

Events arrive titled `"Mãe's birthday"`, `"Jaque 💜∞'s birthday"`, `"Happy birthday!"`. The
name is inside the string and there is no field carrying it.

- **Chosen** — strip a known set of patterns, keep the remainder, and when nothing matches
  keep the entire title and mark the candidate unconfident so the deck can flag it.
- Rejected: **no parsing**, using the raw title as the name. Nothing can silently go wrong,
  but every imported person reads badly forever, including inside a generated message —
  "Happy birthday, Jaque 💜∞'s birthday!"
- Rejected: **strict parsing that skips non-matching titles.** Cleanest names, and it drops
  events whose wording was not anticipated with no trace. That is the same silent-loss shape
  that produced three wrong measurements on this branch already.

**The title's language follows the Google account, not the device.** `"Mãe's birthday"` is
English possessive on a phone whose entire UI is Portuguese. A parser keyed to `Intl`, to the
device locale, or to `expo-localization` would be wrong on exactly this device. The pattern
list is a fixed multilingual set, not a locale lookup.

### Calendar candidates go through the deck, not straight into an import button

They carry a day and a month, so `partitionCandidates` puts them in `ready` — the bucket the
import screen writes with one tap. They must not be written that way.

- **Chosen** — deal them as deck cards with name and date pre-filled. The user fixes
  `Jaque 💜∞`, notices `Pai's birthday` appears twice, and skips `Happy birthday!` before
  anything is stored.
- Rejected: **one-tap import of all ten.** Fastest, and consistent with how the contacts
  `ready` bucket already behaves — but contacts names come from the address book and are
  already right, while these are parsed out of free text and carry known duplicates.

### `ready` means "has a date", not "import without asking"

The deck deals `needsBirthday` for contacts and `ready` for calendars. Rather than adding a
fourth bucket or a flag to `partitionCandidates`, a small pure function in
`src/domain/import.ts` — beside the partitioner it reads — names the choice:

```ts
/** Which bucket the deck deals, per source. `manual` and `ask-link` never reach a deck. */
export function cardsFor(source: PersonSource, partitioned: Partitioned): ImportCandidate[];
```

`'manual'` and `'ask-link'` return an empty array rather than throwing: they are members of
`PersonSource` that no deck can be opened for, and an exhaustive `switch` that returns nothing
for them is honest about that without giving a screen a way to crash.

Rejected: a `confirmAll` option on `partitionCandidates`. It would push a per-source policy
into the one function both sources share, and the bucket names would stop meaning one thing.

### The card's name becomes editable, for this source only

`TriageCard` takes `displayName` as a fixed heading today, which is right for contacts. A
parsed name needs correcting. The card gains an optional `onChangeName`; given one it renders
the name as a text field, without one it renders the heading exactly as now.

Rejected: making the name editable everywhere. It is a real improvement to the contacts deck
too, and it is not this step's job — an editable field there changes a screen that is already
device-verified.

### One scan hook, parameterised by source

`src/hooks/use-contact-scan.ts` opens by arguing against a second copy: *"Two copies would
drift, and the one that drifted would be the one nobody was watching."* Adding
`use-calendar-scan.ts` beside it would be that second copy — the same forty lines of request,
fetch, read both handled sets, partition.

It generalises to `src/hooks/use-source-scan.ts`, taking a `BirthdaySource`.
`useContactScan` and `scanContacts` stay as named wrappers so no existing call site changes.

## The visibility trap

**This is the constraint that matters most, and it is invisible from TypeScript.**

`expo-calendar` hardcodes `CalendarContract.Instances.VISIBLE = 1` into its query on Android —
`InstanceRepository.buildSelection` in the next API, `buildSelectionForEventsQuery` in the
legacy one, neither with an opt-out. `VISIBLE` is a column on the **calendar**, not the event.
A hidden calendar returns zero events, which is the same answer an empty calendar gives.

Worse: `VISIBLE` belongs to whichever app manages calendars on the device. On the Samsung test
phone that is Samsung Calendar, **not** Google Calendar. The calendars read as ticked inside
Google Calendar the whole time while the provider had them hidden. Ticking them in Samsung
Calendar made ten birthdays appear that had been on the device all along.

So a user can have a calendar switched on, look at its events every day, and have it be
unreadable to this app.

**Three consequences, all binding on this step:**

1. The import screen must report how many calendars are hidden, by name. "No birthdays
   found" is a lie whenever a calendar is hidden, and the two are indistinguishable from
   inside the API.
2. The app cannot fix it. `isVisible` is read-only from JavaScript — Kotlin's
   `CalendarUpdateRecord` accepts it, but `ModifiableCalendarProperties` is
   `Pick<ExpoCalendar, 'color' | 'title'>`. The copy must point the user at their calendar
   app, and should name Samsung Calendar's behaviour rather than assuming Google Calendar.
3. Zero birthdays is never reported as a finding without the hidden count beside it.

## The all-day UTC trap

Every birthday event comes back as `startDate=2027-01-25T00:00:00.000Z` — **UTC midnight**,
because Android stores all-day events that way.

Read that with local getters in São Paulo (UTC−3) and Mãe's birthday becomes **24 January**.
Every date is off by one, for every user west of Greenwich, silently.

**And `TZ=Europe/London` in the npm scripts cannot catch it.** London is UTC+0 in January, so
local and UTC agree; in July it is UTC+1, and UTC midnight reads as 01:00 the *same* day. The
existing test timezone is blind to this bug in both directions.

So:

- All-day events are read with **UTC getters**, never local ones.
- The extraction is a pure function in `src/domain/`, and it gets a test run under a
  negative-offset zone. `package.json` gains
  `"test:tz": "TZ=America/Sao_Paulo vitest run"`, and `.github/workflows/` runs it in the
  same job as `npm test` — a second suite nobody runs is worth nothing. Both scripts run the
  whole suite; the point is the zone, not a subset.

This is the one place in the codebase where UTC is correct. `AGENTS.md` says all date
arithmetic is local-calendar arithmetic, and that still holds — a birthday is a calendar day.
What is being done here is not arithmetic; it is decoding a wire format that happens to be
UTC-anchored, back into the calendar day it was meant to represent.

## `src/domain/calendar-title.ts`

Pure. No Expo, no dates, no database.

```ts
export type ParsedBirthdayTitle = {
  displayName: string;
  /** False when no pattern matched and the whole title was kept. The deck flags these. */
  confident: boolean;
};

/** Null when the title is not a birthday at all. */
export function parseBirthdayTitle(title: string): ParsedBirthdayTitle | null;
```

Patterns, case-insensitive, both apostrophes (`'` and `’` — Google writes the curly one):

| Pattern | Example | Name |
|---|---|---|
| `<name>'s birthday` | `Mãe's birthday` | `Mãe` |
| `<name>' birthday` | `Lucas' birthday` | `Lucas` |
| `aniversário de <name>` | `Aniversário de Ana` | `Ana` |
| `niver de <name>` | `Niver de Ana` | `Ana` |
| `cumpleaños de <name>` | `Cumpleaños de Ana` | `Ana` |
| `geburtstag von <name>` | `Geburtstag von Ana` | `Ana` |
| `anniversaire de <name>` | `Anniversaire de Ana` | `Ana` |
| `compleanno di <name>` | `Compleanno di Ana` | `Ana` |
| `<name> geburtstag` | `Ana Geburtstag` | `Ana` |

A title containing a birthday word but matching no pattern — `"Happy birthday!"` — returns
`{ displayName: 'Happy birthday!', confident: false }`. A title with no birthday word at all
returns `null` and never becomes a candidate.

`confident: false` does not reach the domain's `ImportCandidate`, which has no field for it
and should not grow one for a single source. The card shows it instead: an unconfident name
opens the deck's editable name field already focused, so the one case that needs correcting
is the one that asks to be corrected. A confident name renders in the same field, unfocused.

**`niver` matches `Universal`.** The probe's one false positive was
`"Feriado- Confraternização Universal (Ano Novo)"`. The token list must require a word
boundary before `niver`, and there is a test for that exact string.

## `src/domain/calendar-date.ts`

Also pure. Takes what the platform sends and returns a `PartialDate`.

```ts
export function partialDateFromAllDayStart(startDate: string | Date): PartialDate | null;
```

UTC getters, `year: null` always — see below. Null when the input is unparseable.

**Why the year is always null.** `startDate` is the occurrence Android expanded (2027), not
the original. `originalStartDate` — which would carry the real one — is iOS-only. There is no
route to a birth year from a windowed read on Android, so pretending otherwise would store a
person born in 2027.

## `src/sources/calendar.ts`

One file, the existing `BirthdaySource` interface, in the shape `contacts.ts` established:
thin, no branching worth testing, everything fallible pushed into the pure modules above.

```ts
export const calendarSource: BirthdaySource;
```

- `isAvailable()` — iOS or Android.
- `requestAccess()` — `Calendar.requestCalendarPermissions()`, mapped to `'all' | 'none'`.
  There is no limited-access concept here; the iOS 18 `'limited'` value belongs to contacts.
- `fetchCandidates()` — `getCalendars(EntityTypes.EVENT)`, then `listEvents` over one year
  from today. One year, not more: a yearly birthday falls in that window exactly once, and a
  longer window returns the same person twice under one `id`.

Each event becomes a candidate when `parseBirthdayTitle` returns non-null **and**
`partialDateFromAllDayStart` returns a date. `externalId` is `event.id` — device-verified as
stable across a 180-day window shift, and it is the master row rather than the per-occurrence
`instanceId`, which Android documents as volatile.

Plus one export that does not fit the interface:

```ts
/** Titles of calendars the query cannot read. Empty when nothing is hidden. */
export async function hiddenCalendarTitles(): Promise<string[]>;
```

Returns empty when permission is denied, rather than throwing. With no access there are no
calendars to report as hidden, and the import screen is already showing a denial message —
a second warning underneath it would be noise about a problem the user cannot act on yet.

Kept off `BirthdaySource` deliberately: no other source has this problem, and widening a
four-method interface for one platform's quirk would make every future source implement it.

**Matching on calendar identity is not attempted, because it finds nothing.** These events
live in the user's primary calendar. Google Calendar's "Birthdays" heading corresponds to no
row in `CalendarContract`. Samsung's real `local.samsungbirthday` calendar exists and is
empty. Title is the only signal there is.

## Screens

### `src/app/import.tsx`

Gains a calendar section, built the same way as the contacts one and independent of it — a
user with contacts denied must still be offered calendars.

```
2 contacts already have a birthday.      [ Import these 2 ]
──────────────────────────────────────────────────────────
431 have none.                           [ Start ]
──────────────────────────────────────────────────────────
10 birthdays in your calendars.          [ Go through them ]
⚠ 3 calendars are hidden and cannot be read.
```

The hidden-calendar notice names them and says where to fix it. It appears whenever any
calendar is hidden — including when ten birthdays were found, because the eleventh may be in
the hidden one.

### `src/app/triage/index.tsx`

Takes a `source` route param, defaulting to `contacts` so every existing link keeps working.
It already re-scans on mount; it now scans the source it was given, deals `cardsFor(source,
…)`, and pre-fills the draft from the card's birthday when there is one.

The name field follows the same rule: `onChangeName` is passed only when the card carries a
parsed name — that is, for calendar candidates. The contacts deck passes nothing and renders
the heading exactly as it does today, so a screen that is already device-verified does not
change behaviour.

Writes go to `createPerson({ source, externalId })` and `skipContact(source, externalId, …)`
with the same source — **not the hardcoded `'contacts'` those two calls pass today.** That
hardcoding is the single most likely defect in this step: it typechecks, it runs, and it
silently files calendar people under contacts, breaking de-duplication on the next scan.

## Schema and repositories

**None.** `PersonSource` already includes `'calendar'`, `person.source` is typed by it, and
`listExternalIdsBySource` / `listSkippedExternalIds` / `skipContact` all take a source
already. The step-6 schema work covers this step without change — no migration, no
`db:generate`.

## `app.json`

Already done on this branch: the `expo-calendar` plugin entry sets the iOS usage strings and
passes `remindersPermission: false`. Note the Android permissions were never the reason for
it — Expo auto-applies an autolinked module's config plugin, so `READ_CALENDAR` was always
present. `WRITE_CALENDAR` arrives with it and has no opt-out; calendar export needs it in
step 8.

## Deliberately not in this step

- **De-duplicating `Pai's birthday` against `Pai's birthday`.** Both are real events with
  distinct ids. The deck shows both and the user skips one. Automatic matching would have to
  guess whether two same-day people with similar names are one person, and `Jaque` versus
  `Jaque 💜∞` shows how thin that ice is.
- **De-duplicating calendar people against contacts people.** Dedup is by `externalId`, which
  differs across sources by construction. Someone in both is asked about twice. Stated
  omission, same as the manual-entry case in step 6.
- **Writing birthdays back to a calendar.** That is step 8.
- **Reading hidden calendars.** Not possible; see *The visibility trap*.
- **iOS verification.** No iOS build exists. `type === 'birthdays'` and `originalStartDate`
  are iOS-only and untested; nothing in this step depends on either.

## Verification

**Vitest**, all pure:

- `calendar-title.test.ts` — every pattern in the table above; `"Jaque 💜∞'s birthday"` keeps
  the emoji; `"Happy birthday!"` returns `confident: false`;
  `"Feriado- Confraternização Universal (Ano Novo)"` returns `null`; a title with no birthday
  word returns `null`.
- `calendar-date.test.ts` — `2027-01-25T00:00:00.000Z` is 25 January, and the assertion must
  fail if the implementation switches to local getters. **Run under `TZ=America/Sao_Paulo`**,
  because `Europe/London` cannot see this bug.
- `import.test.ts` — `cardsFor('calendar', …)` deals `ready`; `cardsFor('contacts', …)` deals
  `needsBirthday`.

**On a device, because nothing else can answer:**

1. Ten birthdays appear on the import screen, and the names read as people rather than as
   event titles.
2. Hide a calendar in Samsung Calendar → the notice appears and names it; the count drops.
3. Save `Mãe` → she lands on **25 January**, not the 24th. This is the UTC bug and only a
   device in a negative-offset zone shows it end to end.
4. Save from the calendar deck → the row's `source` is `calendar`, and re-scanning moves her
   to `alreadyKnown` rather than dealing her again.
5. Skip one `Pai's birthday`, save the other → the skipped one stays gone across a re-scan.
6. Calendar permission denied → the import screen explains, and the contacts half still works.

**Gates:** `npm run check`, `npm run lint`, `npm test`, the new `npm run test:tz`, then
`expo export --platform android --dump-sourcemap` with a grep of the `.hbc.map` for
`src/sources/calendar.ts`. That grep is the one that matters — `contacts.ts` passed the export
gate vacuously on a previous branch while nothing imported it.

## Changes to `docs/00-design.md`

Already made on this branch: row 2 of the funnel is restored and marked the measured best
source, step 7 is un-cut, and *What the free sources actually yielded* records the numbers and
the three attempts it took to get them.
