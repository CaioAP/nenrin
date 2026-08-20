# Deferred findings

Reviewed, triaged, and deliberately not fixed. Each one was raised during a code review,
judged not worth blocking on, and left here so the decision is visible rather than lost.

This file is not a backlog of ideas — everything below is a known property of code that
shipped. If you touch the named file, this is what a reviewer already found there.

## From the message-templates branch (merged 2026-08-17)

### `tone` crosses the row → domain boundary unvalidated

`src/db/mappers.ts:42` passes `row.tone` straight through. The function's own docblock
argues the opposite case for dates: `makePartialDate` validates on the way *out* as well as
in, because "a row can also arrive from a future sync or a hand-edited backup — so the
boundary refuses to hand a screen a 31 February." A hand-edited `tone` gets no such refusal
and reaches the screen as a `Tone` the type system believes in.

Low impact today: nothing writes `tone` except `setTone`, which is typed. It becomes real
when v2 sync lands and rows arrive from elsewhere. The fix is an `isTone()` guard next to
the `makePartialDate` call.

### `TONES` lives in a screen, not the domain

`src/app/message/[id].tsx:17` holds the tone list and its display labels, while the `Tone`
type itself is `src/domain/message.ts:12`. Adding a fourth tone means editing a route file
and hoping nothing else enumerates them. Only one screen renders tones today, so the
duplication has no second copy to drift from — that is the whole reason it was left.

### The "Copied" status is not cleared when the tone changes

`src/app/message/[id].tsx:37` sets a status line after a copy or share. Switching tone
re-renders the message list underneath it but leaves the status text standing, so it can
describe a message no longer on screen. Cosmetic, and self-clearing on the next action.

### `setTone` is fire-and-forget

`src/app/message/[id].tsx:99` — `if (value !== tone) setTone(person.id, value);`. No
`await`, no `catch`, so a failed write is silent and the chip stays visually selected. This
matches the existing convention rather than introducing one: `settings.tsx` does the same
with `updateSettings`. Worth an app-wide pass over every fire-and-forget repository call,
not a fix scoped to this screen.

### `leapDayPolicy` is not passed to `ageAtNextOccurrence`

`src/app/message/[id].tsx:58` calls `ageAtNextOccurrence(person.birthday, new Date())` with
no policy, so it uses the default rather than the user's setting. Pre-existing rather than
new — `(tabs)/index.tsx` omits it too, and `schedule.ts:146` and `upcoming.ts:48` both pass
it correctly. Only observable for a 29 February birthday in a common year, and only in the
age shown on the message screen.

### The cold-start tap guard is effect-scoped

`handledId` in the notification-tap hook lives inside the effect, so a remount can navigate
once more for a still-cached last response. That is a single extra push, not a loop, and
`AppStack` does not remount in practice. Clearing shared native state from one hook was
judged worse than the symptom.

### The `setTone` / `knownSince` test guards the domain, not the write path

`dc9d31e` fixed `setTone` bumping `updatedAt`, which defeated `fireTimeFor`'s guard and sent
one spurious reminder every remaining morning before the birthday. The regression test pins
the mirror property in `src/domain/`. It cannot cover the `src/db/` write that actually
caused it, because `client.ts` needs a device. The gap is structural, not an oversight.

## From the contacts-import branch

### `src/sources/contacts.ts` has no unit tests, deliberately

It is a sequence of `expo-contacts` calls with no branching of its own beyond `Platform.OS`.
Mocking the SDK and asserting the mock was called proves nothing about a device. Everything
that can be wrong — the birthday fork, impossible dates, name assembly — lives in
`map-contact.ts`, which is pure and has 13 tests covering both platform shapes. If logic ever
accumulates in `contacts.ts`, that logic belongs in the mapper instead.

### `src/db/` cannot be unit tested at all

`client.ts` calls `openDatabaseSync` at module scope, so importing *anything* from `src/db/`
needs a device. `listExternalIdsBySource`, `listSkippedExternalIds` and `skipContact` are
therefore verified by the type checker, the bundler and a device pass, not by Vitest. Same
structural gap already recorded above for the `setTone` write path — not an oversight, and
not fixable without making the database handle async and restructuring every consumer.

### `findByExternalId` and `listExternalIdsBySource` type the same parameter two ways

`Person['source']` in one, `PersonSource` in the other, in the same file. Identical type.
Left alone rather than unified drive-by.

### The probe's summary counts a contact with only `birthday` populated

`probeContacts` in `debug-tools.tsx` reports "N carry a dates[] entry" from a filter that is
correct, but the neighbouring birthday-field count is iOS-only in practice. Cosmetic, in a
`__DEV__` tool that exists to answer one question that has now been answered.

### Contacts import may be the wrong first funnel for this user

The development device's address book holds **0 birthdays across 433 contacts** — the only
two found were written by hand to close the device gate. `docs/00-design.md` ranks work by
cost-per-birthday-acquired and puts contacts import first; on this phone it acquires nothing.
That is one address book and does not re-rank the roadmap on its own, but the open question
is whether Google's auto-generated "Birthdays" calendar holds what Contacts does not. If it
does, calendar import (step 7) out-earns contacts import (step 5) and the order should swap.
Worth answering before step 6 polishes a triage deck fed by an empty source.

## Theme

`backgroundElement` is 1.12:1 against `background` in dark mode (it was 1.32:1 while
`background` was pure black). Unselected chips and the search field use it, and nenrin's
chips have no border — unlike caioalfonso.dev's cards, which sit on `--line`. Checked
directly on Android on 2026-08-17: both read fine. Kept here because 1.12:1 is thin enough
that a dimmer screen or an OLED in sunlight could still lose them. If that happens, raise
that one token to about `oklch(0.30 0.008 240)`; it is a token change, not a re-derivation.

Related: lifting `background` off black cost `tint` its old 5.78:1 contrast. At 4.57:1 it
still clears WCAG AA, but it is now the tightest pair in the app. Darkening `background` is
the lever if a future accent needs the room.

## Generated code

`drizzle/migrations.js` and the files under `drizzle/` are generator output and excluded
from Biome. Indentation and style findings there are not actionable — regenerate with
`npm run db:generate` rather than hand-editing.
