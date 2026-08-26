# The triage deck — design

Step 6 of the acquisition funnel. Turns the contacts read path built in step 5 into a
screen a person can actually use, and adds the deck that `docs/00-design.md` calls "the core
UX bet".

Branched from `feat/contacts-import`, which is open as PR #2 and unmerged. Rebase onto
`main` once it lands.

## Why this exists

Step 5 ends with `partitionCandidates` returning three buckets and nothing rendering them.
The only caller is a `__DEV__` button. On the development device the buckets are:

| bucket | count | what it means |
|---|---|---|
| `ready` | 2 | has a birthday, never seen — importable with no questions |
| `needsBirthday` | 431 | no birthday — deck candidates |
| `alreadyKnown` | 0 | already a person, or explicitly refused |

Those two numbers are the whole design problem. **2 is a one-tap win; 431 is a slog.** They
are different decisions with different costs, so the UI must not put them behind one button.

## Decisions

Each of these was chosen over a named alternative. The alternative is recorded because the
reason is not recoverable from the code.

### The import screen presents two decisions, never nested

```
2 contacts already have a birthday.   [ Import these 2 ]
──────────────────────────────────────────────────────
431 have none.                        [ Start triage ]
```

Rejected: one `[Import contacts]` button that writes the 2 silently and opens the deck. It
is fewer taps, but the silent write is invisible and the deck opens unasked. The user should
be able to take the free win and decline the work.

### Swipe left skips, swipe right saves, a button refuses

`Don't ask again` is the only irreversible action on the card, so it is the only one that is
not a gesture. The two reversible actions get the thumb; the permanent one requires aim.

Rejected: swipe right for "don't ask again", which was the first proposal. A flick would
have permanently buried a contact with no confirmation.

### Nothing saves on the day tap

`docs/00-design.md` targets "one gesture and two taps". An explicit commit — swipe right or
the Save button — makes it three. **This is a deliberate divergence from that document and
that line is updated as part of this work**, rather than left asserting a target the code
misses.

What the third tap buys: nothing saves by surprise, and the optional year stops being a
second-class field reachable only before an auto-advance fires.

### The card uses grids, not scrolling chip rows

`BirthdayFields` renders month and day as horizontally scrolling rows. A horizontal swipe
starting on one of those rows is ambiguous — scroll the row, or throw the card?
`react-native-gesture-handler` can arbitrate that, but the arbitration is a classic source
of "sometimes it just doesn't work", and it would land on the one screen the portfolio demo
video is about.

A 3×4 month grid and a 7×5 day grid fit without scrolling, so **the horizontal axis belongs
entirely to the swipe and there is nothing to arbitrate.** Tapping the 25th directly is also
fewer interactions than scrolling a row to find it — `BirthdayFields`' scroll-to-reveal
machinery exists precisely because chips run off the right edge, and a grid has no
off-screen problem to solve.

Cost: the deck does not reuse `BirthdayFields`. The add/edit form keeps the row version.

### Skip is persisted as `deferred`, not held in memory

Reopening the deck must not re-deal the 47 cards you already skipped. Two ways to do that:

- **Chosen** — every skip writes a `skipped` row with `kind = 'deferred'`; refusals write
  `kind = 'refused'`. The deck deals candidates with no row at all. Order-independent: a
  contact added or deleted on the phone cannot shift what "already handled" means.
- Rejected — persist a cursor position. No schema change, but the index points into a list
  that reorders whenever the address book changes, so 47 silently comes to mean someone
  else.

**In this step nothing reads `kind` differently** — both values keep a candidate out of the
deck. The column still earns its place on arrival, because the distinction is unrecoverable
if not captured at write time: once 47 rows exist without it, "not now" and "never" are
indistinguishable forever.

### Deck state is a pure domain module

Rejected: `useState` inside the screen. The rules that matter here — a cursor that never
runs past the end of 431 cards, a resume that lands on the first unhandled card and not one
early, a refusal that sticks — all fail quietly and, under screen-local state, only on a
device. `AGENTS.md` draws this line ("if a change to `src/domain/` needs a simulator to
verify, it is in the wrong file"); the inverse is what bites here.

### Writes happen per card, not batched at the end

Save creates the person immediately; skip and refuse write their row immediately.
Crash-safe, matches the repository rule, and keeps `alreadyKnown` honest if the user
re-scans mid-deck. Batching would mean fewer writes and forty ways to lose forty cards of
work.

## Screens

### `src/app/import.tsx`

Reached from Settings. On mount runs the scan currently living in the debug button:
`requestAccess()` → `fetchCandidates()` → `listExternalIdsBySource` + `listSkippedExternalIds`
→ `partitionCandidates`.

That sequence moves out of `debug-tools.tsx` into `src/hooks/use-contact-scan.ts` so the
debug panel and the real screen share one copy rather than drifting.

States it must render, all of which are reachable on a real device:

- **scanning** — 433 contacts is not instant.
- **the happy path** — the two decisions above.
- **permission denied** — with what to do about it. `docs/00-design.md` requires the app be
  fully usable with contacts denied, so this is a normal state, not an error.
- **limited access (iOS 18)** — the user picked a subset; say so rather than reporting a
  small number as if it were the whole book.
- **nothing to do** — no candidates, or everything already handled.
- **`[ Ask me again about the N I skipped ]`** — present only when N > 0. Backed by
  `clearDeferred('contacts')`. Without it, deferring everyone leaves the deck permanently
  empty with no way back — and it is what makes `kind` load-bearing on arrival rather than
  speculative.

### `src/app/triage/index.tsx`

The deck. **Re-scans on mount rather than receiving 431 objects through router params**,
which keeps it deep-linkable and correct after the app has been backgrounded for a week.

Shows progress (`47 of 431`), the current card, and an exhausted state when
`currentCard` returns null.

## `src/domain/triage.ts`

```ts
export type DeckState = {
  readonly cards: readonly ImportCandidate[];
  readonly cursor: number;
};

export function makeDeck(candidates: readonly ImportCandidate[]): DeckState;
export function currentCard(state: DeckState): ImportCandidate | null;
export function advance(state: DeckState): DeckState;
export function progress(state: DeckState): { done: number; total: number };
```

A cursor over an immutable list rather than a queue that shifts: it makes `progress` free,
and "back one card" a subtraction if that is ever wanted. `currentCard` returning `null` is
how the screen learns the deck is exhausted — there is no second flag that could disagree
with the cursor.

Per-card draft state is `PersonDraft` from the existing `src/domain/draft.ts`, with the name
pre-filled from the contact and notes left empty, validated by `parsePersonDraft`. **The
deck writes no validation of its own** — an impossible date on a triage card produces the
same message as on the add form because it is the same function.

## Schema and repositories

One migration: `skipped` gains `kind TEXT NOT NULL DEFAULT 'refused'`. The default is
correct for existing rows; everything written so far came from don't-ask-again.

- `skipContact(source, externalId, kind)` — grows a parameter. No call sites today, so
  nothing breaks.
- `clearDeferred(source)` — new. Deletes `kind = 'deferred'` rows for a source.
- `countDeferred(source)` — new. Feeds the "ask me again" label.
- `listSkippedExternalIds(source)` — unchanged. Returns both kinds, which is what keeps a
  handled candidate out of the deck.

`createPerson` already accepts `source` and `externalId`, so **saving a single triage card
needs no repository change at all.**

`[ Import these 2 ]` does need one, because it is a bulk write:

- `createFromCandidates(candidates)` — new. Inserts every ready candidate in one
  transaction and returns how many landed.

Why a repository function rather than a loop of `createPerson` in the screen: the
`ImportCandidate` → `NewPerson` conversion has to live somewhere, and it cannot live in
`src/domain/`, because `NewPerson` is defined in `src/db/mappers.ts` and the domain may not
import from the database. Putting it in the repository keeps the screen free of mapping
logic and keeps the whole import inside one transaction, so a failure halfway through
writes nobody rather than half of them.

Only candidates with a non-null birthday are valid input. That is exactly what `ready`
means, and the function takes `ready` — it does not re-filter and it does not accept the
other two buckets.

After the write the import screen re-runs its scan, so the imported people move from `ready`
to `alreadyKnown` and the counts on screen match the database.

Run `npm run db:generate` after editing `schema.ts` — the app applies the generated bundle,
not the schema file.

## The card

`src/components/triage-card.tsx` — name, month grid, day grid, a collapsed
`+ year (optional)`, and the action row:

```
  ← skip        [ Don't ask again ]  save →
```

A `Pan` gesture drives a reanimated `translateX`. The card follows the finger; past a
threshold it flies out and commits; under it, it springs back. `activeOffsetX` and
`failOffsetY` keep a vertical drag from arming a swipe if the card ever needs to scroll on a
short screen.

**Swipe right on an incomplete draft must visibly refuse.** The card resists at a small
clamp, springs back, and surfaces `parsePersonDraft`'s existing "Pick a month and a day."
A gesture that does nothing is indistinguishable from a gesture that missed.

Two cards render at a time — the current one and a peek behind it. Never 431.

**Every gesture also has a button**, because a swipe cannot be performed by a screen reader.
Gesture-only actions would make the deck unusable with TalkBack and VoiceOver.

### `GestureHandlerRootView` must be added to `src/app/_layout.tsx`

Nothing in `src/` renders it today. expo-router re-exports it for react-navigation's own
stack internals, which is not the app root. Without it, **pan gestures silently do nothing
on Android** — and `check`, `lint`, `test` and `expo export` all pass. Same failure
signature as the `expo-notifications` module-scope import and `ContactField.BIRTHDAY`
already recorded in `AGENTS.md`.

The Babel side needs no change: `babel-preset-expo` passes a `worklets` option through, and
the Reanimated 4 docs confirm the Worklets plugin ships in the Expo preset. The custom
`plugins` array that inlines `.sql` does not displace it.

## Deliberately not in this step

- **Filtering out businesses.** A meaningful share of 431 is shops, clinics and delivery
  numbers. The available heuristic — company set with no given or family name — would
  silently hide real people stored only under a company name. Noise now beats invisible
  data loss.
- **iOS limited-access re-picking** via `presentAccessPicker()`. No iOS build exists, so it
  could not be verified.
- **De-duplication against manually added people.** Dedup is by `externalId`; someone typed
  in by hand and also present in Contacts will be asked about again and produce a second
  person. Name matching is fuzzy and out of v1. **Stated omission, not a surprise.**
- **Writing birthdays back to the phone's contacts.** Needs write permission and is a
  separate consent conversation. The UI should say once that entries live only in Nenrin.

## Verification

**Vitest** — `src/domain/triage.test.ts`: the cursor never passes the end, `currentCard`
returns null exactly at exhaustion, `progress` counts correctly, an empty deck is
immediately exhausted. Validation is already covered by the existing `parsePersonDraft`
tests.

**On a device, because nothing else can answer:**

1. Swipe left and right; confirm the threshold feels right and the card commits.
2. Swipe right with no month/day — must resist and explain, not sit still.
3. Kill the app mid-deck, reopen: resume skips what was deferred.
4. `Don't ask again` survives a rescan.
5. 431 cards do not jank.
6. Contacts permission denied — the import screen explains rather than throwing.
7. `Ask me again` restores the deferred and leaves refusals buried.

**Gates:** `npm run check`, `npm run lint`, `npm test`, `npm run db:generate`, then
`expo export --platform android --dump-sourcemap` with a grep of the `.hbc.map` for
`src/domain/triage.ts` and `src/components/triage-card.tsx`. Both start life reachable only
from a new route, which is exactly the shape that passed the export gate vacuously twice on
the previous branch.

## Changes to `docs/00-design.md`

The "one gesture and two taps" line in the v1 scope section is updated to describe the
explicit commit and say why. Left alone, it would assert a target this design deliberately
misses.
