# Calendar Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read birthdays out of the device's calendars and deal them through the step-6
triage deck, so the ten birthdays sitting in Google Calendar cost ten taps instead of ten
manual entries.

**Architecture:** Two new pure domain modules do everything that can be wrong — 
`calendar-title.ts` pulls a person's name out of an event title, `calendar-date.ts` decodes
Android's UTC-midnight all-day wire format back into a calendar day. `src/sources/calendar.ts`
is a thin `BirthdaySource` over them, in the shape `contacts.ts` established. The scan hook
generalises from one source to any source, the import screen grows a second, independent
section, and the triage route takes a `source` param so one deck serves both.

**Tech Stack:** React Native 0.86 / Expo SDK 57, expo-router (typed routes), expo-calendar
57.0.2 (next API), Drizzle + expo-sqlite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-calendar-import-design.md`

## Global Constraints

**Dates are independent of timezone. This is the constraint the whole step turns on.**

- **A birthday is a calendar day, not an instant.** `25/05` is stored as
  `{ month: 5, day: 25, year: null }` — three integers, no timezone anywhere. It renders as
  25 May in São Paulo, in Tokyo and in London, and the reminder fires on the user's *local*
  morning of 25 May wherever they are. Fly to Tokyo and it is still 25 May.
- **UTC is used exactly once in this step, and it is not arithmetic.** Android sends every
  all-day event as `2027-01-25T00:00:00.000Z`. That string is a *wire format for a calendar
  day*, not a moment. `partialDateFromAllDayStart` decodes it with UTC getters to recover the
  three integers. Reading it with local getters in São Paulo (UTC−3) yields **24 January**,
  and the corruption is then permanent and silent. UTC appears in `src/domain/calendar-date.ts`
  and nowhere else in this step.
- **AGENTS.md's "all date arithmetic is local-calendar arithmetic" still holds unchanged.**
  Nothing downstream of the decode touches UTC.
- **`TZ=Europe/London` cannot catch the bug above.** London is UTC+0 in January (local and
  UTC agree) and UTC+1 in July (UTC midnight reads as 01:00 the *same* day). So
  `package.json` gains `"test:tz": "TZ=America/Sao_Paulo vitest run"` and CI runs it in the
  same job as `npm test`. Verified before writing this plan: the whole 243-test suite already
  passes under `TZ=America/Sao_Paulo`, so `test:tz` runs the whole suite, not a subset.
  This does **not** replace London — São Paulo has had no DST since 2019, so
  `schedule.test.ts`'s daylight-saving cases pass there without ever crossing a transition.
  Two zones, both required, neither sufficient.

Everything else:

- **`src/domain/` imports nothing from Expo, React Native, or the database.** Pure functions
  over plain objects.
- **Platform access lives behind an adapter in `src/sources/`**, implementing `BirthdaySource`.
- **Every database write goes through a repository function in `src/db/`.** No screen touches
  the database directly.
- **No schema work in this step.** `PersonSource` already includes `'calendar'` and
  `listExternalIdsBySource` / `listSkippedExternalIds` / `skipContact` / `countDeferred` /
  `clearDeferred` all take a source. Do **not** run `npm run db:generate`; there is nothing
  to generate and a spurious migration would fail CI's drift guard.
- **`import * as Calendar from 'expo-calendar'` at module scope is safe** — unlike
  `expo-notifications`. The module resolves `CalendarNext` at import and substitutes
  `ExpoGoCalendarNextStub` under Expo Go, so the import survives and only the calls throw.
  Do not copy the probe's dynamic `await import('expo-calendar')` into the adapter; it exists
  in `debug-tools.tsx` for a different reason and would make the adapter async for nothing.
- **Nothing in `src/components/` or `src/app/` has automated tests.** There is no React
  testing setup and adding one is out of scope. Those tasks are gated by `check`, `lint`,
  `expo export` and a device.
- Vitest `include` is `['src/domain/**/*.test.ts', 'src/db/**/*.test.ts', 'src/sources/**/*.test.ts']`.
  New test files must land under one of those globs or they silently never run.
- Biome owns formatting. Run `npm run lint:fix` before committing; there is no Prettier.
- Commit messages: conventional commits, ending with the
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

### Three deviations from the spec, decided here

The spec is the argument; these are the three places the plan resolves something it left open.

1. **`use-contact-scan.ts` is deleted rather than kept as wrappers.** The spec keeps
   `useContactScan` and `scanContacts` "so no existing call site changes" — but Tasks 6 and 7
   rewrite both screen call sites anyway, leaving `useContactScan` with no callers. A dead
   export is worse than the one-line change `debug-tools.tsx` needs. Task 5 moves the file.
2. **The unconfident name is not auto-focused.** The spec says an unconfident parse "opens
   the deck's editable name field already focused" — but it also says `confident` must not
   reach `ImportCandidate`, and there is no other route from the adapter to the screen. Rather
   than growing the domain type for one source, the field renders editable-but-unfocused for
   every calendar card. Auto-focusing would also pop the keyboard over the month/day grid on
   every card, which is the wrong trade for the confident majority.
3. **The calendar section gets its own "ask me again" offer.** The spec's mockup shows the
   offer only under contacts, but the calendar deck writes `deferred` rows through the same
   `skipContact`, so without a per-source offer a deferred calendar person is unreachable
   forever. `countDeferred` and `clearDeferred` already take a source; this is two lines.

---

### Task 1: Parse a person's name out of an event title

**Files:**
- Create: `src/domain/calendar-title.ts`
- Test: `src/domain/calendar-title.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ParsedBirthdayTitle = { displayName: string; confident: boolean }`
  - `function parseBirthdayTitle(title: string): ParsedBirthdayTitle | null`

- [ ] **Step 1: Write the failing test**

Create `src/domain/calendar-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseBirthdayTitle } from './calendar-title';

describe('parseBirthdayTitle', () => {
  it("reads the name out of an English possessive", () => {
    expect(parseBirthdayTitle("Mãe's birthday")).toEqual({ displayName: 'Mãe', confident: true });
  });

  it('accepts the curly apostrophe Google actually writes', () => {
    expect(parseBirthdayTitle('Mãe’s birthday')).toEqual({ displayName: 'Mãe', confident: true });
  });

  it('keeps everything in the name, emoji included', () => {
    // Real title off the test device. Truncating here would silently rename someone.
    expect(parseBirthdayTitle("Jaque 💜∞'s birthday")).toEqual({
      displayName: 'Jaque 💜∞',
      confident: true,
    });
  });

  it('handles a name already ending in s', () => {
    expect(parseBirthdayTitle("Lucas' birthday")).toEqual({
      displayName: 'Lucas',
      confident: true,
    });
  });

  it('reads Portuguese', () => {
    expect(parseBirthdayTitle('Aniversário de Ana')).toEqual({
      displayName: 'Ana',
      confident: true,
    });
    expect(parseBirthdayTitle('Niver de Ana')).toEqual({ displayName: 'Ana', confident: true });
  });

  it('reads Spanish, German, French and Italian', () => {
    expect(parseBirthdayTitle('Cumpleaños de Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Geburtstag von Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Anniversaire de Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Compleanno di Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Ana Geburtstag')?.displayName).toBe('Ana');
  });

  it('is case-insensitive', () => {
    expect(parseBirthdayTitle("ana's BIRTHDAY")).toEqual({ displayName: 'ana', confident: true });
  });

  it('keeps the whole title, unconfident, when no pattern matches', () => {
    // The deck shows this one in an editable field rather than dropping it. Silent loss is
    // the failure shape that produced three wrong measurements on this branch already.
    expect(parseBirthdayTitle('Happy birthday!')).toEqual({
      displayName: 'Happy birthday!',
      confident: false,
    });
  });

  it('does not mistake Universal for niver', () => {
    // The probe's one false positive, from a loose substring token list. `niver` needs a
    // word boundary or every New Year holiday in Brazil becomes a person.
    expect(parseBirthdayTitle('Feriado- Confraternização Universal (Ano Novo)')).toBeNull();
  });

  it('returns null for a title with no birthday word at all', () => {
    expect(parseBirthdayTitle('Dentist')).toBeNull();
    expect(parseBirthdayTitle('   ')).toBeNull();
    expect(parseBirthdayTitle('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/calendar-title.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-title"`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/calendar-title.ts`:

```ts
/**
 * An event title → the person's name inside it.
 *
 * Pure. No Expo, no dates, no database.
 *
 * The title is the only signal there is. Birthday events sit in the user's *primary*
 * calendar — Google Calendar's "Birthdays" heading corresponds to no row in
 * `CalendarContract`, and Samsung's real `local.samsungbirthday` calendar is empty — so
 * matching on calendar identity finds none of them. No field carries the name either.
 *
 * **The wording follows the Google account's language, not the device's.** `"Mãe's birthday"`
 * came off a phone whose entire UI is Portuguese. A parser keyed to `Intl`, to the device
 * locale, or to `expo-localization` would be wrong on exactly the device this was measured
 * on, so the list below is a fixed multilingual set rather than a locale lookup.
 */

export type ParsedBirthdayTitle = {
  displayName: string;
  /** False when no pattern matched and the whole title was kept. The deck flags these. */
  confident: boolean;
};

/**
 * Is this a birthday at all?
 *
 * Separate from the extraction patterns, because this is the gate that decides `null` versus
 * `confident: false` — and it is where a loose match does damage. `niver` needs `\b` on both
 * sides: without it `Confraternização Universal` is a person, which the probe demonstrated.
 * `anivers` catches `aniversário`, which `\bniver\b` deliberately does not.
 */
const BIRTHDAY_WORDS = [
  /birthday/i,
  /\bb-?day\b/i,
  /anivers/i,
  /\bniver\b/i,
  /cumplea/i,
  /geburtstag/i,
  /compleanno/i,
  /anniversaire/i,
];

/**
 * Title shapes, first match wins. Group 1 is the name.
 *
 * Both apostrophes: Google writes the curly `’`, keyboards write the straight `'`, and a
 * parser that knows only one silently falls through to the unconfident branch for half the
 * events on a device.
 *
 * `(.+)` is greedy on purpose — `"Jaque 💜∞'s birthday"` must keep the emoji. Nothing here
 * tries to identify what a name looks like; the user is going to see it in an editable field.
 */
const NAME_PATTERNS = [
  /^(.+)['’]s\s+birthday$/i,
  /^(.+)['’]\s+birthday$/i,
  /^anivers[áa]rio\s+de\s+(.+)$/i,
  /^niver\s+de\s+(.+)$/i,
  /^cumplea[ñn]os\s+de\s+(.+)$/i,
  /^geburtstag\s+von\s+(.+)$/i,
  /^anniversaire\s+de\s+(.+)$/i,
  /^compleanno\s+di\s+(.+)$/i,
  /^(.+)\s+geburtstag$/i,
];

/** Null when the title is not a birthday at all. */
export function parseBirthdayTitle(title: string): ParsedBirthdayTitle | null {
  const trimmed = title.trim();
  if (trimmed === '') return null;
  if (!BIRTHDAY_WORDS.some((word) => word.test(trimmed))) return null;

  for (const pattern of NAME_PATTERNS) {
    const name = pattern.exec(trimmed)?.[1]?.trim();
    if (name) return { displayName: name, confident: true };
  }

  // A birthday whose wording nobody anticipated. Kept, not dropped — the alternative loses
  // real people with no trace, which is the same silent-loss shape as the visibility trap.
  return { displayName: trimmed, confident: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/calendar-title.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/calendar-title.ts src/domain/calendar-title.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): parse a person's name out of a birthday event title

The title is the only signal a calendar birthday carries — the events sit in the
primary calendar and no field holds the name. Nine patterns across six languages,
because the wording follows the Google account's language rather than the device's:
"Mãe's birthday" came off a phone whose entire UI is Portuguese.

An unmatched title keeps the whole string and reports confident: false rather than
being dropped. Silent loss is the failure shape this branch has already produced
three times.

`niver` requires a word boundary. Without it "Confraternização Universal" is a
person, which is exactly what the device probe reported.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Decode Android's all-day wire format, and pin a second test timezone

**Files:**
- Create: `src/domain/calendar-date.ts`
- Test: `src/domain/calendar-date.test.ts`
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/ci.yml` (add a step after `npm run test`)

**Interfaces:**
- Consumes: `PartialDate`, `makePartialDate` from `src/domain/birthday.ts`.
- Produces: `function partialDateFromAllDayStart(startDate: string | Date): PartialDate | null`

- [ ] **Step 1: Add the second test script**

In `package.json`, directly after the `"test"` line:

```json
    "test": "TZ=Europe/London vitest run",
    "test:tz": "TZ=America/Sao_Paulo vitest run",
    "test:watch": "TZ=Europe/London vitest",
```

- [ ] **Step 2: Run both suites to confirm the second zone is green before anything depends on it**

Run: `npm test && npm run test:tz`
Expected: both PASS, 253 tests each — the 243 that existed before this branch, plus Task 1's
10. The 243 were confirmed green under `TZ=America/Sao_Paulo` before this plan was written,
so a failure here is a real regression: stop and report it rather than editing a test to
suit the zone.

- [ ] **Step 3: Write the failing test**

Create `src/domain/calendar-date.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { partialDateFromAllDayStart } from './calendar-date';

/**
 * These assertions only mean something in a negative-offset zone.
 *
 * `npm run test:tz` pins TZ=America/Sao_Paulo (UTC−3) for exactly this file. Under
 * TZ=Europe/London the January case passes with local getters too — London is UTC+0 then —
 * so the suite that normally runs is blind to the bug this file exists to catch.
 */
describe('partialDateFromAllDayStart', () => {
  it('reads UTC midnight as the calendar day it encodes', () => {
    // Local getters in São Paulo would say 24 January. Mãe's birthday is the 25th.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z')).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('holds in the other half of the year, where London is UTC+1', () => {
    expect(partialDateFromAllDayStart('2027-07-15T00:00:00.000Z')).toEqual({
      month: 7,
      day: 15,
      year: null,
    });
  });

  it('does not slip across a month boundary', () => {
    // The worst case: local getters turn this into 31 January.
    expect(partialDateFromAllDayStart('2027-02-01T00:00:00.000Z')).toEqual({
      month: 2,
      day: 1,
      year: null,
    });
  });

  it('keeps 29 February, which is a real birthday', () => {
    expect(partialDateFromAllDayStart('2028-02-29T00:00:00.000Z')).toEqual({
      month: 2,
      day: 29,
      year: null,
    });
  });

  it('accepts a Date as well as a string, because the SDK types say `string | Date`', () => {
    expect(partialDateFromAllDayStart(new Date('2027-01-25T00:00:00.000Z'))).toEqual({
      month: 1,
      day: 25,
      year: null,
    });
  });

  it('never fills in a year, however plausible the one on the wire looks', () => {
    // 2027 is the occurrence Android expanded, not the birth year. Storing it would claim
    // someone was born next year.
    expect(partialDateFromAllDayStart('2027-01-25T00:00:00.000Z')?.year).toBeNull();
  });

  it('returns null for something that is not a date', () => {
    expect(partialDateFromAllDayStart('not a date')).toBeNull();
    expect(partialDateFromAllDayStart('')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/domain/calendar-date.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-date"`.

- [ ] **Step 5: Write the implementation**

Create `src/domain/calendar-date.ts`:

```ts
/**
 * An all-day event's start → the calendar day it means.
 *
 * Pure. **This is the one place in the codebase where UTC is correct**, and it is worth
 * being precise about why, because AGENTS.md says the opposite everywhere else.
 *
 * Android stores all-day events as UTC midnight: a birthday on 25 January arrives as
 * `2027-01-25T00:00:00.000Z`. That is a *wire format for a calendar day*, not an instant —
 * the event does not begin at a moment, it occupies a date. Reading it back with local
 * getters in São Paulo (UTC−3) yields 24 January, and every date in the app is then off by
 * one for every user west of Greenwich, permanently and silently.
 *
 * So this decodes with UTC getters and hands back three integers. Nothing downstream of here
 * touches UTC: `PartialDate` has no timezone, the birthday renders as the same day
 * everywhere, and the reminder fires on the user's own local morning. This is not
 * arithmetic — it is undoing an encoding.
 *
 * `TZ=Europe/London` cannot check this file. London is UTC+0 in January, so local and UTC
 * agree; in July it is UTC+1, and UTC midnight reads as 01:00 on the *same* day. Both
 * directions are blind. Hence `npm run test:tz`.
 */

import { makePartialDate, type PartialDate } from './birthday';

/** Null when the input is unparseable. */
export function partialDateFromAllDayStart(startDate: string | Date): PartialDate | null {
  const instant = typeof startDate === 'string' ? new Date(startDate) : startDate;
  if (Number.isNaN(instant.getTime())) return null;

  // No try/catch around `makePartialDate`. `getUTCMonth() + 1` is always 1–12 and
  // `getUTCDate()` is always a day that month really has, so the throw is unreachable —
  // a catch here would be dead code pretending to handle something.
  //
  // The year is always null, and not because it is unknown: `startDate` is the occurrence
  // Android expanded (2027), never the original. `originalStartDate` would carry the real
  // one and is iOS-only. Passing 2027 through would store a person born next year.
  return makePartialDate(instant.getUTCMonth() + 1, instant.getUTCDate(), null);
}
```

- [ ] **Step 6: Run the test in the zone that can see the bug**

Run: `TZ=America/Sao_Paulo npx vitest run src/domain/calendar-date.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Prove the test would catch the bug it exists for**

Temporarily change `getUTCMonth`/`getUTCDate` to `getMonth`/`getDate` in
`src/domain/calendar-date.ts` and run:

Run: `TZ=America/Sao_Paulo npx vitest run src/domain/calendar-date.test.ts`
Expected: FAIL — at least the January, February-boundary and leap-day cases.

Then run the same file under the *normal* zone:

Run: `TZ=Europe/London npx vitest run src/domain/calendar-date.test.ts`
Expected: PASS — which is the whole point. **Revert the change before continuing.**

- [ ] **Step 8: Wire the second zone into CI**

In `.github/workflows/ci.yml`, replace the single test line:

```yaml
      - run: npm run test
```

with:

```yaml
      - run: npm run test

      # The same suite again in a negative-offset zone, in the same job — a suite nobody
      # runs is worth nothing. Neither zone is sufficient alone. London has two DST
      # transitions a year, which is what makes schedule.test.ts test something; São Paulo
      # has had none since 2019 but is UTC−3, which is the only way to see a calendar
      # all-day event decoded with local getters instead of UTC ones.
      - run: npm run test:tz
```

- [ ] **Step 9: Run every gate**

Run: `npm run lint:fix && npm run check && npm test && npm run test:tz`
Expected: 0 errors, 260 tests in each suite (243 + 10 from Task 1 + 7 from Task 2).

- [ ] **Step 10: Commit**

```bash
git add src/domain/calendar-date.ts src/domain/calendar-date.test.ts package.json .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(domain): decode an all-day event's UTC midnight into a calendar day

Android sends every all-day event as 2027-01-25T00:00:00.000Z. That is a wire
format for a date, not an instant — read it with local getters in São Paulo and
Mãe's birthday becomes 24 January, silently, for every user west of Greenwich.

UTC getters here and nowhere else. Downstream nothing changes: PartialDate carries
no timezone, the day renders the same everywhere, and the reminder fires on the
user's own local morning.

The year is always null. startDate is the occurrence Android expanded, not the
original; originalStartDate is iOS-only. Passing 2027 through would store someone
born next year.

Adds test:tz pinned to TZ=America/Sao_Paulo, run in the same CI job as npm test.
Europe/London is blind to this in both directions — UTC+0 in January, and UTC+1 in
July where UTC midnight still reads as the same day.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Name the per-source bucket choice

**Files:**
- Modify: `src/domain/import.ts` (append)
- Test: `src/domain/import.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `PersonSource` from `src/domain/person.ts`; `Partitioned`, `ImportCandidate` from
  this file.
- Produces: `function cardsFor(source: PersonSource, partitioned: Partitioned): ImportCandidate[]`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/import.test.ts` (and add `cardsFor` to the existing import from
`./import`):

```ts
describe('cardsFor', () => {
  const partitioned = {
    ready: [candidate({ externalId: 'r1', displayName: 'Has A Date' })],
    needsBirthday: [candidate({ externalId: 'n1', displayName: 'No Date', birthday: null })],
    alreadyKnown: [candidate({ externalId: 'k1', displayName: 'Known' })],
  };

  it('deals the contacts deck the candidates with no birthday', () => {
    expect(cardsFor('contacts', partitioned).map((c) => c.displayName)).toEqual(['No Date']);
  });

  it('deals the calendar deck the candidates that already have one', () => {
    // Not a contradiction of `ready`. `ready` means "has a date", not "import without
    // asking" — a calendar name is parsed out of free text and the duplicates are real, so
    // every one of them gets confirmed.
    expect(cardsFor('calendar', partitioned).map((c) => c.displayName)).toEqual(['Has A Date']);
  });

  it('never deals what is already known, from either source', () => {
    const dealt = [...cardsFor('contacts', partitioned), ...cardsFor('calendar', partitioned)];
    expect(dealt.map((c) => c.externalId)).not.toContain('k1');
  });

  it('returns nothing for the sources that have no deck', () => {
    // `manual` and `ask-link` are real members of PersonSource that no deck can be opened
    // for. Empty rather than a throw: honest about it without giving a screen a way to crash.
    expect(cardsFor('manual', partitioned)).toEqual([]);
    expect(cardsFor('ask-link', partitioned)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `cardsFor is not exported` / `is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/import.ts`:

```ts
/**
 * Which bucket the deck deals, per source. `manual` and `ask-link` never reach a deck.
 *
 * A function beside the partitioner rather than a flag inside it. `partitionCandidates` is
 * shared by every source and its bucket names each mean one thing; a `confirmAll` option
 * would push a per-source policy into it and make `ready` mean two things at once.
 *
 * The asymmetry is the point. Contacts arrive with names from the address book and dates the
 * user entered, so `ready` is safe to write in one tap and only `needsBirthday` needs asking
 * about. Calendar candidates arrive with a name parsed out of an event title and known
 * duplicates — `Pai's birthday` appears twice on the test device — so every one of them is
 * confirmed before anything is stored.
 */
export function cardsFor(source: PersonSource, partitioned: Partitioned): ImportCandidate[] {
  switch (source) {
    case 'contacts':
      return partitioned.needsBirthday;
    case 'calendar':
      return partitioned.ready;
    case 'manual':
    case 'ask-link':
      return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run test:tz`
Expected: PASS, 264 tests each (243 + 10 + 7 + 4).

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors. (`tsc` proves the `switch` is exhaustive over `PersonSource` — adding a
fifth source later will fail here rather than returning `undefined` at runtime.)

- [ ] **Step 6: Commit**

```bash
git add src/domain/import.ts src/domain/import.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): name which bucket each source's deck deals

Contacts deal needsBirthday; calendars deal ready. `ready` means "has a date", not
"import without asking" — a calendar name is parsed out of an event title and the
duplicates are real, so every one gets confirmed.

A function beside the partitioner rather than a flag inside it: partitionCandidates
is shared by every source, and a confirmAll option would make `ready` mean two
different things depending on who asked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The calendar adapter

**Files:**
- Create: `src/sources/calendar.ts`

**Interfaces:**
- Consumes: `parseBirthdayTitle` (Task 1), `partialDateFromAllDayStart` (Task 2),
  `ImportCandidate` from `src/domain/import.ts`, `AccessLevel` / `BirthdaySource` from
  `src/sources/types.ts`.
- Produces:
  - `const calendarSource: BirthdaySource` (`id` is `'calendar'`)
  - `async function hiddenCalendarTitles(): Promise<string[]>`

No test file, deliberately — the same call as `contacts.ts`. Every branch worth testing was
pushed into the two pure modules above; what is left is SDK calls, and mocking
`expo-calendar` to assert the mock was called proves nothing about a device.

- [ ] **Step 1: Write the adapter**

Create `src/sources/calendar.ts`:

```ts
/**
 * The device's calendars as a birthday source.
 *
 * Thin, in the shape `contacts.ts` established: everything that can be wrong — the name
 * inside a title, the UTC-midnight wire format — lives in `src/domain/calendar-title.ts` and
 * `src/domain/calendar-date.ts`, which are pure and tested. What is left here is a sequence
 * of SDK calls with no branching of its own, which is why there is no test file.
 *
 * **A module-scope import is safe here, unlike `expo-notifications`.** `expo-calendar`
 * resolves `CalendarNext` at import and substitutes `ExpoGoCalendarNextStub` under Expo Go,
 * so the import survives and only the calls throw. A dev build is required either way.
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { partialDateFromAllDayStart } from '@/domain/calendar-date';
import { parseBirthdayTitle } from '@/domain/calendar-title';
import type { ImportCandidate } from '@/domain/import';
import type { AccessLevel, BirthdaySource } from './types';

/**
 * How far forward to read, in days.
 *
 * One year exactly. A yearly birthday falls inside that window once; a longer one returns
 * the same person twice under one `id`, and the second copy would look like a duplicate the
 * user has to skip.
 */
const WINDOW_DAYS = 365;

const MS_PER_DAY = 86_400_000;

export const calendarSource: BirthdaySource = {
  id: 'calendar',

  async isAvailable() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  },

  /**
   * No limited-access concept here. `'limited'` is an iOS 18 *contacts* idea — the calendar
   * permission is granted or it is not.
   */
  async requestAccess(): Promise<AccessLevel> {
    const permission = await Calendar.requestCalendarPermissions();
    return permission.granted ? 'all' : 'none';
  },

  async fetchCandidates(): Promise<ImportCandidate[]> {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    if (calendars.length === 0) return [];

    // Every calendar, not a birthdays calendar. Birthday events live in the user's primary
    // calendar; Google Calendar's "Birthdays" heading corresponds to no row in
    // `CalendarContract`, and Samsung's real `local.samsungbirthday` calendar is empty.
    // Matching on calendar identity finds none of them.
    //
    // Calendars the user has hidden are absent from this result whatever we pass —
    // `expo-calendar` hardcodes `Instances.VISIBLE = 1` into the query. See
    // `hiddenCalendarTitles`, which is how the screen tells the user that happened.
    const from = new Date();
    const to = new Date(from.getTime() + WINDOW_DAYS * MS_PER_DAY);
    const events = await Calendar.listEvents(
      calendars.map((calendar) => calendar.id),
      from,
      to,
    );

    return events.flatMap(toCandidate);
  },
};

/**
 * `flatMap` rather than `map` + `filter`, so the two "not a birthday" answers and the
 * successful one are one expression each and nothing needs a non-null assertion after.
 */
function toCandidate(event: Calendar.ExpoCalendarEvent): ImportCandidate[] {
  // All-day only. `partialDateFromAllDayStart` is named for its precondition: UTC getters
  // are correct *because* the platform encodes an all-day date as UTC midnight. A timed
  // 21:00 event in São Paulo is 00:00 UTC the following day, so decoding one that way
  // would land the birthday on the wrong date — and a titled "Ana's birthday" dinner
  // booking is exactly the kind of event a user really has.
  if (!event.allDay) return [];

  const parsed = parseBirthdayTitle(event.title);
  if (!parsed) return [];

  const birthday = partialDateFromAllDayStart(event.startDate);
  if (!birthday) return [];

  return [
    {
      // `event.id`, not `instanceId`. `id` is the provider's master row, verified on a
      // device to survive a 180-day window shift; `instanceId` is Android-only, differs per
      // occurrence, and is documented as "volatile ... not guaranteed to always refer to the
      // same instance". `externalId` is the whole de-duplication contract, so an id that
      // changed between reads would re-deal the same person on every scan, silently.
      externalId: event.id,
      displayName: parsed.displayName,
      birthday,
      source: 'calendar',
    },
  ];
}

/**
 * Titles of calendars the query cannot read. Empty when nothing is hidden.
 *
 * `expo-calendar` hardcodes `CalendarContract.Instances.VISIBLE = 1` into its selection on
 * Android — `InstanceRepository.buildSelection` in the next API, `buildSelectionForEventsQuery`
 * in the legacy one, neither with an opt-out. `VISIBLE` is a column on the *calendar*, not
 * the event, so a hidden calendar returns zero events and looks exactly like an empty one.
 *
 * Worse, the column belongs to whichever app manages calendars on the device. On the Samsung
 * test phone that is Samsung Calendar, not Google Calendar: the calendars read as ticked
 * inside Google Calendar the whole time while the provider had them hidden. So a user can
 * have a calendar switched on, look at its events every day, and have it be unreadable here.
 *
 * The app cannot fix it — `isVisible` is read-only from JavaScript, because
 * `ModifiableCalendarProperties` is `Pick<ExpoCalendar, 'color' | 'title'>` even though
 * Kotlin's `CalendarUpdateRecord` accepts it. All the screen can do is say which ones.
 *
 * Kept off `BirthdaySource` deliberately: no other source has this problem, and widening a
 * four-method interface for one platform's quirk would make every future source implement it.
 *
 * Returns empty on a denied permission rather than throwing. With no access there are no
 * calendars to report as hidden, and the screen is already showing a denial message — a
 * second warning underneath it would be noise about a problem the user cannot act on yet.
 */
export async function hiddenCalendarTitles(): Promise<string[]> {
  const permission = await Calendar.getCalendarPermissions();
  if (!permission.granted) return [];

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  // `=== false`, not `!isVisible`. The field is `isVisible?: boolean` and is undefined where
  // the platform does not report it — which means "unknown", not "hidden".
  return calendars
    .filter((calendar) => calendar.isVisible === false)
    .map((calendar) => calendar.title);
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run check && npm run lint:fix`
Expected: no errors.

- [ ] **Step 3: Confirm nothing bundles it yet, and know why that is fine**

Run:
```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/sources/calendar.ts' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```
Expected: `0`. Nothing under `src/app/` imports it yet, so it is not in the module graph —
`expo export` passing here is a **vacuous** pass and proves nothing. That is the exact trap
`contacts.ts` fell into on a previous branch. The grep that counts is on Task 7, after the
import screen reaches this file.

- [ ] **Step 4: Commit**

```bash
git add src/sources/calendar.ts
git commit -m "$(cat <<'EOF'
feat(sources): read birthdays out of the device's calendars

One year forward across every calendar, because birthday events live in the user's
primary calendar — Google Calendar's "Birthdays" heading corresponds to no row in
CalendarContract, and Samsung's real birthday calendar is empty. Title is the only
signal there is.

All-day events only. UTC getters are correct precisely because the platform encodes
an all-day date as UTC midnight; a timed evening event would decode to the wrong
day.

externalId is event.id, the provider's master row — verified on a device to survive
a 180-day window shift. instanceId differs per occurrence and Android documents it
as volatile, which would re-deal the same person on every scan.

hiddenCalendarTitles is exported beside the interface rather than added to it. No
other source can have this problem, and the screen has to name the hidden calendars
because "no birthdays found" and "the calendar is unreadable" are the same answer
from inside the API.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: One scan hook, parameterised by source

**Files:**
- Create: `src/hooks/use-source-scan.ts`
- Delete: `src/hooks/use-contact-scan.ts`
- Modify: `src/components/debug-tools.tsx:8,240`
- Modify: `src/app/import.tsx:11,25` (import swap only — the restructure is Task 6)
- Modify: `src/app/triage/index.tsx:14,30` (import swap only — the rest is Task 7)

**Interfaces:**
- Consumes: `BirthdaySource` from `src/sources/types.ts`; `contactsSource`;
  `listExternalIdsBySource`, `listSkippedExternalIds`, `partitionCandidates`.
- Produces:
  - `type ScanResult = { access: AccessLevel; partitioned: Partitioned }` (unchanged shape)
  - `type SourceScan = { state: 'scanning' } | { state: 'ready'; result: ScanResult } | { state: 'failed'; error: Error }`
  - `async function scanSource(source: BirthdaySource): Promise<ScanResult>`
  - `function useSourceScan(source: BirthdaySource): { scan: SourceScan; rescan: () => void }`

`useContactScan` / `scanContacts` / `ContactScan` **cease to exist**. See deviation 1 in
Global Constraints.

- [ ] **Step 1: Create the generalised hook**

Create `src/hooks/use-source-scan.ts` with the body of `use-contact-scan.ts`, changed in
exactly four places — the doc comment, the two hardcoded `'contacts'` strings, and the two
signatures:

```ts
/**
 * One scan of one source, shared by the import screen, the triage deck and the debug panel.
 *
 * The sequence — request access, fetch, read both handled sets, partition — is identical for
 * every source, which is why this takes a `BirthdaySource` rather than existing twice. Two
 * copies would drift, and the one that drifted would be the one nobody was watching.
 */

import { useCallback, useEffect, useState } from 'react';

import { listExternalIdsBySource } from '@/db/people';
import { listSkippedExternalIds } from '@/db/skipped';
import { type Partitioned, partitionCandidates } from '@/domain/import';
import type { AccessLevel, BirthdaySource } from '@/sources/types';

export type ScanResult = {
  access: AccessLevel;
  partitioned: Partitioned;
};

/**
 * Fresh buckets per call rather than a shared constant.
 *
 * A module-level object would hand the same three array instances to every denied scan, so
 * one consumer sorting or pushing in place would corrupt every other consumer's view. The
 * aliasing is invisible at the call site, which is exactly why it should not exist.
 */
function nothingFound(): Partitioned {
  return { ready: [], needsBirthday: [], alreadyKnown: [] };
}

/**
 * Runs the whole read path once, for one source.
 *
 * **Both database reads key off `source.id`.** They were hardcoded to `'contacts'` when
 * there was one source; leaving them would partition calendar candidates against the
 * contacts sets, so every calendar person would look new forever and nothing the user
 * skipped would stay skipped. It typechecks perfectly.
 *
 * Access denied returns empty buckets rather than throwing. The app must stay fully usable
 * with a source refused, so "no" is an ordinary answer here, not an error.
 */
export async function scanSource(source: BirthdaySource): Promise<ScanResult> {
  const access = await source.requestAccess();
  if (access === 'none') return { access, partitioned: nothingFound() };

  const candidates = await source.fetchCandidates();
  const [imported, skipped] = await Promise.all([
    listExternalIdsBySource(source.id),
    listSkippedExternalIds(source.id),
  ]);

  return { access, partitioned: partitionCandidates(candidates, { imported, skipped }) };
}

export type SourceScan =
  | { state: 'scanning' }
  | { state: 'ready'; result: ScanResult }
  | { state: 'failed'; error: Error };

/**
 * Whatever was thrown, as an Error worth showing someone.
 *
 * `String(value)` on a rejection shaped `{ code, message }` — which is what an RN bridge
 * call, expo-contacts, expo-calendar or expo-sqlite actually produces — yields
 * "[object Object]", and the import screen puts `error.message` on screen verbatim. So the
 * one case that most needs its message preserved is exactly the one a bare `String()` throws
 * away.
 */
function asError(value: unknown): Error {
  if (value instanceof Error) return value;

  if (typeof value === 'object' && value !== null && 'message' in value) {
    return new Error(String((value as { message: unknown }).message));
  }

  return new Error(String(value));
}

/**
 * The same scan as a screen state machine.
 *
 * `rescan` exists because both screens change what the scan would return — importing the
 * ready bucket, or handling a card — and a stale count on screen is worse than a spinner.
 *
 * `source` belongs in the dependency list because it really is one: every adapter is a
 * module-level constant, so the identity is stable, and a screen that switches sources gets
 * a fresh scan rather than the previous source's buckets.
 */
export function useSourceScan(source: BirthdaySource): { scan: SourceScan; rescan: () => void } {
  const [scan, setScan] = useState<SourceScan>({ state: 'scanning' });
  const [nonce, setNonce] = useState(0);

  // `nonce` is not read in the body — it exists only so `rescan` can force this effect to
  // run again, which is exactly what the exhaustive-deps rule cannot see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a rescan trigger, not a data dependency
  useEffect(() => {
    let cancelled = false;
    setScan({ state: 'scanning' });

    scanSource(source)
      .then((result) => {
        if (!cancelled) setScan({ state: 'ready', result });
      })
      .catch((error: unknown) => {
        if (!cancelled) setScan({ state: 'failed', error: asError(error) });
      });

    // Guards against a scan of four hundred contacts resolving after the screen is gone.
    return () => {
      cancelled = true;
    };
  }, [source, nonce]);

  const rescan = useCallback(() => setNonce((n) => n + 1), []);

  return { scan, rescan };
}
```

- [ ] **Step 2: Delete the old hook**

```bash
git rm src/hooks/use-contact-scan.ts
```

- [ ] **Step 3: Point the three call sites at the new one**

In `src/components/debug-tools.tsx`, replace the import on line 8:

```ts
import { scanSource } from '@/hooks/use-source-scan';
import { contactsSource } from '@/sources/contacts';
```

and inside `runContactScan`:

```ts
  const { access, partitioned } = await scanSource(contactsSource);
```

In `src/app/import.tsx`, replace the import on line 11 and the call on line 25:

```ts
import { useSourceScan } from '@/hooks/use-source-scan';
import { contactsSource } from '@/sources/contacts';
```
```tsx
  const { scan, rescan } = useSourceScan(contactsSource);
```

Also update the comment on line 66 — `useContactScan` no longer exists:

```tsx
      // `useSourceScan` already scans on mount, so refreshing on the first focus would
```

In `src/app/triage/index.tsx`, the same two edits (line 14 and line 30). Nothing else in
either screen changes in this task; both are rewritten in Tasks 6 and 7.

- [ ] **Step 4: Confirm nothing still references the deleted module**

Run: `grep -rn "use-contact-scan\|useContactScan\|scanContacts\|ContactScan" src`
Expected: no output.

- [ ] **Step 5: Run every gate**

Run: `npm run lint:fix && npm run check && npm test && npm run test:tz`
Expected: 0 errors, 264 tests each. (`tsc` is the real gate here — a missed call site is a
resolve error, not a runtime surprise.)

- [ ] **Step 6: Commit**

```bash
git add -A src/hooks src/components/debug-tools.tsx src/app/import.tsx src/app/triage/index.tsx
git commit -m "$(cat <<'EOF'
refactor(hooks): one scan hook, parameterised by source

use-contact-scan.ts opened by arguing against a second copy — "two copies would
drift, and the one that drifted would be the one nobody was watching". Adding
use-calendar-scan.ts beside it would have been that copy.

Both database reads now key off source.id. They were hardcoded to 'contacts', which
would have partitioned calendar candidates against the contacts sets: every
calendar person new forever, and nothing the user skipped staying skipped. It
typechecks either way.

The old module is deleted rather than kept as wrappers. Both screen call sites are
rewritten in the next two commits regardless, which would leave useContactScan with
no callers at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The import screen offers both sources, independently

**Files:**
- Create: `src/components/import-contacts-section.tsx`
- Create: `src/components/import-calendar-section.tsx`
- Modify: `src/app/import.tsx` (reduced to a shell)

**Interfaces:**
- Consumes: `useSourceScan`, `ScanResult` (Task 5); `cardsFor` (Task 3); `calendarSource`,
  `hiddenCalendarTitles` (Task 4); `contactsSource`; `createFromCandidates`, `countDeferred`,
  `clearDeferred`.
- Produces:
  - `function ImportContactsSection(): JSX.Element`
  - `function ImportCalendarSection(): JSX.Element`

  Neither takes props. Each owns its own scan, its own busy/error state and its own
  focus-refresh, which is the whole point — see Step 1.

- [ ] **Step 1: Understand why this is a restructure and not an added section**

`import.tsx` today has three **full-screen early returns**: `scanning`, `failed`, and
`access === 'none'`. All three are about contacts. Bolt a calendar section on and a user with
contacts denied gets "Contacts are off" and never sees the calendar half — directly against
the spec's requirement that the two be independent. Contacts denied is also not a rare edge
case: it is the state the app is explicitly required to stay fully usable in.

So each source's three states move down to section level, and the denial copy becomes a
message inside its own section. Two self-contained components, each owning one source, is
what makes that structural rather than a pile of conditionals in one file.

- [ ] **Step 2: Extract the contacts section, behaviour unchanged**

Create `src/components/import-contacts-section.tsx`. This is today's `import.tsx` — every
piece of state, `refresh`, the `firstFocus` guard, `importReady`, `askAgain`, the two
`View style={styles.section}` blocks and `describeContacts` — moved verbatim, with the three
full-screen returns rewritten as in-section messages:

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { createFromCandidates } from '@/db/people';
import { clearDeferred, countDeferred } from '@/db/skipped';
import { useSourceScan } from '@/hooks/use-source-scan';
import { contactsSource } from '@/sources/contacts';
import { ActionButton } from './action-button';
import { ThemedText } from './themed-text';

/**
 * The address book half of the import screen.
 *
 * Its own component, with its own scan, because the two halves must not be able to take each
 * other down. Contacts denied is a state the app is required to stay fully usable in — as a
 * full-screen return it also hid the calendar half, which is the bug this extraction fixes.
 *
 * The two decisions stay separate and never nested. Importing the handful of contacts that
 * already carry a birthday is free and instant; filling in the hundreds that do not is real
 * work. One button for both would either do the work unasked or hide the free win behind it.
 */
export function ImportContactsSection() {
  const router = useRouter();
  const { scan, rescan } = useSourceScan(contactsSource);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [deferred, setDeferred] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Tracks mount state across both effects and `refresh`, so a count that resolves after the
  // screen is gone never calls `setDeferred` on a dead component.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Read alongside every scan, because "ask me again" must disappear the moment it is used
  // and reappear the moment the deck defers something.
  useEffect(() => {
    countDeferred('contacts').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, []);

  const refresh = useCallback(() => {
    // Any refresh retires a stale receipt — the count it describes may no longer be true
    // once the candidate lists have been re-read. The same goes for a failure message:
    // without this it would outlive the condition that caused it, sitting on screen across
    // navigation until the user happened to retry that exact action.
    setImported(null);
    setWriteError(null);
    rescan();
    countDeferred('contacts').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, [rescan]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // `useSourceScan` already scans on mount, so refreshing on the first focus would read
      // the address book twice for one entry. Only a *return* needs the refresh — the deck
      // runs while this screen stays mounted underneath it, so its counts and its deferred
      // total are both stale by the time the user comes back.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  if (scan.state === 'scanning') {
    return (
      <View style={styles.section}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Reading your contacts…</ThemedText>
      </View>
    );
  }

  if (scan.state === 'failed') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Could not read your contacts</ThemedText>
        <ThemedText themeColor="textSecondary">{scan.error.message}</ThemedText>
        <ActionButton label="Try again" onPress={refresh} />
      </View>
    );
  }

  const { access, partitioned } = scan.result;

  if (access === 'none') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Contacts are off</ThemedText>
        <ThemedText themeColor="textSecondary">
          Nenrin cannot read your address book. Everything else still works — you can add people by
          hand, and turn contacts on later in your device settings.
        </ThemedText>
        <ActionButton label="Check again" onPress={refresh} />
      </View>
    );
  }

  const { ready, needsBirthday } = partitioned;

  const importReady = async () => {
    if (importing) return;
    setImporting(true);
    setWriteError(null);
    try {
      const count = await createFromCandidates(ready);
      // `refresh` clears `imported` as part of retiring any stale receipt — call it before
      // setting the real count, not after, or it would erase the very receipt this import
      // just earned.
      refresh();
      setImported(count);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not add those contacts.');
    } finally {
      // Cleared even on failure, or a rejected write would leave the button dead forever.
      setImporting(false);
    }
  };

  const askAgain = async () => {
    if (restoring) return;
    setRestoring(true);
    setWriteError(null);
    try {
      await clearDeferred('contacts');
      refresh();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not restore those contacts.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {access === 'limited' ? (
        <ThemedText type="small" themeColor="textSecondary">
          You have shared some of your contacts with Nenrin, not all of them. These counts cover
          only what you shared.
        </ThemedText>
      ) : null}

      <View style={styles.section}>
        {/*
         * The zero-state has to be true in every way of arriving at it: nothing ever had a
         * birthday, they were imported a moment ago, or they were imported on a previous
         * visit and `imported` has since been reset by a remount. Wording that holds in all
         * three beats a branch per case — the first version of this had a branch and still
         * lied on the third.
         */}
        <ThemedText type="subtitle">
          {ready.length > 0
            ? `${describeContacts(ready.length)} already ${ready.length === 1 ? 'has' : 'have'} a birthday`
            : 'No contacts with a birthday left to import'}
        </ThemedText>
        {ready.length > 0 ? (
          <ActionButton
            label={
              importing
                ? 'Importing…'
                : `Import ${ready.length === 1 ? 'this one' : `these ${ready.length}`}`
            }
            onPress={importReady}
            disabled={importing}
          />
        ) : null}
        {imported !== null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Added {describeContacts(imported)}.
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">
          {needsBirthday.length === 0
            ? 'Nothing left to go through'
            : `${describeContacts(needsBirthday.length)} ${needsBirthday.length === 1 ? 'has' : 'have'} none`}
        </ThemedText>
        {needsBirthday.length > 0 ? (
          <>
            <ThemedText themeColor="textSecondary">
              Nenrin can ask you about them one at a time. Skip anyone you do not know — you can
              always come back.
            </ThemedText>
            <ActionButton
              label="Start"
              onPress={() => router.push({ pathname: '/triage', params: { source: 'contacts' } })}
            />
          </>
        ) : null}
      </View>

      {deferred > 0 ? (
        <View style={styles.section}>
          <ActionButton
            label={`Ask me again about the ${deferred} I skipped`}
            onPress={askAgain}
            disabled={restoring}
          />
        </View>
      ) : null}

      {writeError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {writeError}
        </ThemedText>
      ) : null}
    </>
  );
}

function describeContacts(count: number): string {
  return `${count} contact${count === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, alignItems: 'flex-start' },
});
```

- [ ] **Step 3: Write the calendar section**

Create `src/components/import-calendar-section.tsx`:

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { clearDeferred, countDeferred } from '@/db/skipped';
import { cardsFor } from '@/domain/import';
import { useSourceScan } from '@/hooks/use-source-scan';
import { calendarSource, hiddenCalendarTitles } from '@/sources/calendar';
import { ActionButton } from './action-button';
import { ThemedText } from './themed-text';

/**
 * The calendars half of the import screen.
 *
 * Independent of the contacts half by construction — separate component, separate scan,
 * separate error state. On the development device this is the higher-yield source of the
 * two: ten birthdays against the address book's two.
 *
 * No "import these" button, unlike contacts. Calendar candidates all carry a date, so they
 * land in `ready` — but `ready` means "has a date", not "import without asking". These names
 * are parsed out of free text and the duplicates are real (`Pai's birthday` appears twice on
 * the test phone), so every one goes through the deck. `cardsFor` is where that is decided.
 */
export function ImportCalendarSection() {
  const router = useRouter();
  const { scan, rescan } = useSourceScan(calendarSource);
  const [hidden, setHidden] = useState<string[]>([]);
  const [deferred, setDeferred] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * The hidden count is read beside the scan rather than carried inside `ScanResult`.
   *
   * Same reasoning that keeps `hiddenCalendarTitles` off `BirthdaySource`: it is one
   * platform's quirk, and putting it in the type every source shares would make every future
   * source answer a question only this one has. Nothing goes wrong if it stays local.
   */
  const readAside = useCallback(() => {
    hiddenCalendarTitles().then((titles) => {
      if (alive.current) setHidden(titles);
    });
    countDeferred('calendar').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, []);

  useEffect(readAside, [readAside]);

  const refresh = useCallback(() => {
    setWriteError(null);
    rescan();
    readAside();
  }, [rescan, readAside]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  /**
   * Shown under every outcome, including a successful one.
   *
   * "No birthdays found" is a lie whenever a calendar is hidden, and from inside the API the
   * two are indistinguishable — `expo-calendar` hardcodes `Instances.VISIBLE = 1`, so a
   * hidden calendar returns zero events exactly like an empty one. It appears above a count
   * of ten too, because the eleventh may be in the hidden one.
   *
   * The copy names the *device's* calendar app rather than Google Calendar. On the Samsung
   * test phone the calendars read as ticked inside Google Calendar the whole time while
   * Samsung Calendar — which owns the column there — had them hidden. Nenrin cannot fix it
   * either: `isVisible` is read-only from JavaScript.
   */
  const hiddenNotice =
    hidden.length > 0 ? (
      <ThemedText type="small" themeColor="textSecondary">
        {`⚠ ${hidden.length === 1 ? 'One calendar is' : `${hidden.length} calendars are`} hidden and cannot be read: ${hidden.join(', ')}. Nenrin cannot switch them on — do it in the calendar app that manages them on this device, which may not be the one you usually open.`}
      </ThemedText>
    ) : null;

  if (scan.state === 'scanning') {
    return (
      <View style={styles.section}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Reading your calendars…</ThemedText>
      </View>
    );
  }

  if (scan.state === 'failed') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Could not read your calendars</ThemedText>
        <ThemedText themeColor="textSecondary">{scan.error.message}</ThemedText>
        <ActionButton label="Try again" onPress={refresh} />
      </View>
    );
  }

  const { access, partitioned } = scan.result;

  if (access === 'none') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Calendars are off</ThemedText>
        <ThemedText themeColor="textSecondary">
          Nenrin cannot read your calendars, so it cannot find the birthdays already saved there.
          Everything else still works — turn calendars on later in your device settings.
        </ThemedText>
        <ActionButton label="Check again" onPress={refresh} />
      </View>
    );
  }

  const cards = cardsFor('calendar', partitioned);

  const askAgain = async () => {
    if (restoring) return;
    setRestoring(true);
    setWriteError(null);
    try {
      await clearDeferred('calendar');
      refresh();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not restore those birthdays.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="subtitle">
          {cards.length === 0
            ? 'No birthdays found in your calendars'
            : `${cards.length} birthday${cards.length === 1 ? '' : 's'} in your calendars`}
        </ThemedText>
        {cards.length > 0 ? (
          <>
            <ThemedText themeColor="textSecondary">
              Nenrin reads the name out of the event title, so check each one before saving it.
            </ThemedText>
            <ActionButton
              label="Go through them"
              onPress={() => router.push({ pathname: '/triage', params: { source: 'calendar' } })}
            />
          </>
        ) : null}
        {hiddenNotice}
      </View>

      {deferred > 0 ? (
        <View style={styles.section}>
          <ActionButton
            label={`Ask me again about the ${deferred} I skipped`}
            onPress={askAgain}
            disabled={restoring}
          />
        </View>
      ) : null}

      {writeError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {writeError}
        </ThemedText>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, alignItems: 'flex-start' },
});
```

- [ ] **Step 4: Reduce `import.tsx` to a shell**

Replace the whole of `src/app/import.tsx` with:

```tsx
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ImportCalendarSection } from '@/components/import-calendar-section';
import { ImportContactsSection } from '@/components/import-contacts-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Where an import starts.
 *
 * Two sources, presented as two independent offers. Independent all the way down: each
 * section runs its own scan and owns its own failure, so a denied permission on one shows a
 * message *inside* that section instead of replacing the screen. The previous version
 * returned full-screen for contacts scanning, failing or denied — which meant a user with
 * contacts off never saw the calendar half at all, and calendars are the higher-yield source
 * on the device this was measured on.
 */
export default function ImportScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Import' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ImportContactsSection />

        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

        <ImportCalendarSection />

        <ThemedText type="small" themeColor="textSecondary">
          Birthdays you add here are saved in Nenrin only. Your contacts and calendars are never
          changed.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  divider: { height: StyleSheet.hairlineWidth },
});
```

- [ ] **Step 5: Confirm the calendar adapter is now really in the bundle**

Run:
```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/sources/calendar.ts' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```
Expected: `1` or more. This is the gate that means something — on Task 4 the same grep
returned 0 and proved nothing, because nothing under `src/app/` reached the file.

- [ ] **Step 6: Run every gate**

Run: `npm run lint:fix && npm run check && npm test && npm run test:tz`
Expected: 0 errors, 264 tests each.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/import.tsx src/components/import-contacts-section.tsx src/components/import-calendar-section.tsx
git commit -m "$(cat <<'EOF'
feat(import): offer contacts and calendars as two independent sources

Each half is its own component with its own scan and its own failure state. That is
the whole change: import.tsx returned full-screen when the contacts scan was
running, failed or denied, so a user with contacts off never saw the calendar half —
and calendars are the higher-yield source on the device this was measured on.

The calendar half has no one-tap import. Its candidates all carry a date and land in
`ready`, but `ready` means "has a date", not "import without asking" — the names are
parsed out of event titles and the duplicates are real.

The hidden-calendar notice shows under every outcome, a count of ten included: the
eleventh birthday may be in the hidden calendar, and from inside expo-calendar a
hidden calendar and an empty one are the same answer. The copy points at whichever
app manages calendars on the device rather than naming Google Calendar, because on
the Samsung test phone it is Samsung Calendar that owns the column.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: One deck, two sources — and the source it writes

**Files:**
- Modify: `src/components/triage-card.tsx` (add `onChangeName`)
- Modify: `src/app/triage/index.tsx` (route param, draft seeding, the source it writes)

**Interfaces:**
- Consumes: `cardsFor` (Task 3), `useSourceScan` (Task 5), `calendarSource` (Task 4),
  `contactsSource`, `PersonSource`, `PersonDraft`.
- Produces: nothing new for later tasks. `TriageCard` gains one optional prop:
  `onChangeName?: (next: string) => void`.

- [ ] **Step 1: Make the card's name editable, when asked**

In `src/components/triage-card.tsx`, add `onChangeName` to the props object and its type:

```tsx
export function TriageCard({
  displayName,
  onChangeName,
  draft,
  onChangeDraft,
  onAction,
  canSave,
  error,
  onBlocked,
}: {
  displayName: string;
  /**
   * Given, the name renders as a text field. Omitted, it renders as a fixed heading exactly
   * as before.
   *
   * Only the calendar deck passes it. A contacts name comes from the address book and is
   * already right; a calendar name was parsed out of an event title and needs correcting —
   * `Jaque 💜∞` is a real one. Making the field appear everywhere would change a contacts
   * screen that is already device-verified, for no gain there.
   */
  onChangeName?: (next: string) => void;
  draft: PersonDraft;
  onChangeDraft: (next: PersonDraft) => void;
  onAction: (action: TriageAction) => void;
  canSave: boolean;
  /** Shown when a save was attempted with an incomplete date. */
  error: string | null;
  onBlocked: () => void;
}) {
```

Replace the heading line:

```tsx
        <ThemedText type="subtitle">{displayName}</ThemedText>
```

with:

```tsx
        {onChangeName ? (
          <TextInput
            value={displayName}
            onChangeText={onChangeName}
            placeholder="Name"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Name"
            style={[styles.name, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
        ) : (
          <ThemedText type="subtitle">{displayName}</ThemedText>
        )}
```

And add to `styles`, beside `year`:

```ts
  name: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    alignSelf: 'stretch',
    fontSize: 20,
    fontWeight: '600',
  },
```

Nothing else in the file changes. `TextInput` is already imported.

- [ ] **Step 2: Take the source from the route, and deal its cards**

In `src/app/triage/index.tsx`, replace the imports and the top of the component:

```tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TriageCard } from '@/components/triage-card';
import { Spacing } from '@/constants/theme';
import { createPerson } from '@/db/people';
import { skipContact } from '@/db/skipped';
import { EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from '@/domain/draft';
import { cardsFor, type ImportCandidate } from '@/domain/import';
import type { PersonSource } from '@/domain/person';
import { advance, currentCard, makeDeck, progress, type TriageAction } from '@/domain/triage';
import { useSourceScan } from '@/hooks/use-source-scan';
import { useTheme } from '@/hooks/use-theme';
import { calendarSource } from '@/sources/calendar';
import { contactsSource } from '@/sources/contacts';
```

and inside the component, replacing the `useSourceScan(contactsSource)` line from Task 5:

```tsx
  // Defaults to contacts, so `/triage` with no param keeps working — including a link saved
  // before this route took a param at all.
  const { source: raw } = useLocalSearchParams<{ source?: string }>();
  const source: PersonSource = raw === 'calendar' ? 'calendar' : 'contacts';
  const birthdaySource = source === 'calendar' ? calendarSource : contactsSource;

  const { scan, rescan } = useSourceScan(birthdaySource);
```

Replace the deck memo:

```tsx
  const deck = useMemo(() => {
    if (scan.state !== 'ready') return null;
    return makeDeck(cardsFor(source, scan.result.partitioned));
  }, [scan, source]);
```

- [ ] **Step 3: Seed the draft from the card, once per card**

Add above the component:

```tsx
/**
 * A card's own answer, as an editable draft.
 *
 * Contacts cards arrive with no date and this is just their name. Calendar cards arrive with
 * both, and the user is confirming rather than entering — so the date is pre-filled and the
 * name is pre-filled and correctable.
 */
function draftFromCandidate(candidate: ImportCandidate): PersonDraft {
  return {
    ...EMPTY_PERSON_DRAFT,
    displayName: candidate.displayName,
    month: candidate.birthday?.month ?? null,
    day: candidate.birthday?.day ?? null,
    year: candidate.birthday?.year == null ? '' : String(candidate.birthday.year),
  };
}
```

Replace the draft state declaration:

```tsx
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const [seededFor, setSeededFor] = useState<string | null>(null);
```

and, immediately after `const card = currentCard(state);`:

```tsx
  // Seeding during render, not in an effect. An effect would paint one frame with the
  // *previous* card's date still in the fields, and on a deck the user is flicking through
  // that frame is visible. React re-runs the body before committing, so nothing reaches the
  // screen half-seeded.
  //
  // This is also the only reset there is: `nextCard` no longer clears the draft, so there is
  // one place a card's draft comes from and no way for one card's edits to leak into the
  // next.
  if (card && seededFor !== card.externalId) {
    setSeededFor(card.externalId);
    setDraft(draftFromCandidate(card));
  }
```

Remove `setDraft(EMPTY_PERSON_DRAFT);` from `nextCard`, leaving:

```tsx
  const nextCard = () => {
    setCursor(advance(state).cursor);
    setWriteFailure(null);
    setShowValidation(false);
  };
```

- [ ] **Step 4: Validate the draft's own name, not the card's**

Replace:

```tsx
  const parsed = parsePersonDraft(
    { ...draft, displayName: card.displayName },
    new Date().getFullYear(),
  );
```

with:

```tsx
  // No `displayName: card.displayName` override any more. The draft is seeded from the card
  // and, for calendar cards, is the thing the user edits — overriding it here would validate
  // the parsed title while saving something else.
  const parsed = parsePersonDraft(draft, new Date().getFullYear());
```

- [ ] **Step 5: Write the source the deck is actually dealing**

Replace the two hardcoded strings in `handle`:

```tsx
      if (action === 'save') {
        if (!parsed.ok) return;
        await createPerson({
          displayName: parsed.value.displayName,
          birthday: parsed.value.birthday,
          // `source`, not 'contacts'. The hardcoded version typechecks, runs, and files
          // every calendar person under contacts — which breaks de-duplication silently:
          // `listExternalIdsBySource('calendar')` would never find them, so the same ten
          // people would be dealt again on every scan.
          source,
          externalId: card.externalId,
        });
      } else {
        await skipContact(source, card.externalId, action === 'refuse' ? 'refused' : 'deferred');
      }
```

- [ ] **Step 6: Make the two messages source-aware, and render the editable name**

Replace the `scan.state === 'failed'` heading:

```tsx
        <ThemedText type="subtitle">
          {source === 'calendar'
            ? 'Could not read your calendars'
            : 'Could not read your contacts'}
        </ThemedText>
```

Replace the `access === 'none'` block's heading and body:

```tsx
        <ThemedText type="subtitle">
          {source === 'calendar' ? 'Calendars are off' : 'Contacts are off'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          {source === 'calendar'
            ? 'Nenrin cannot read your calendars. Everything else still works — you can add people by hand, and turn calendars on later in your device settings.'
            : 'Nenrin cannot read your address book. Everything else still works — you can add people by hand, and turn contacts on later in your device settings.'}
        </ThemedText>
```

And in the `TriageCard` element, bind the name to the draft and pass the setter only for
calendar:

```tsx
        <TriageCard
          key={`${card.externalId}:${attempt}`}
          displayName={draft.displayName}
          onChangeName={
            source === 'calendar'
              ? (displayName) => setDraft((current) => ({ ...current, displayName }))
              : undefined
          }
          draft={draft}
          onChangeDraft={setDraft}
          onAction={handle}
          canSave={canSave}
          error={writeFailure ?? (showValidation ? validationMessage : null)}
          onBlocked={() => setShowValidation(true)}
        />
```

`displayName={draft.displayName}` rather than `card.displayName` for both sources: the draft
is seeded from the card, so for contacts the two are always equal and nothing changes, while
for calendar the field must show what the user typed.

- [ ] **Step 7: Run every gate**

Run: `npm run lint:fix && npm run check && npm test && npm run test:tz`
Expected: 0 errors, 264 tests each.

- [ ] **Step 8: Confirm the route really carries the param**

Run: `npm run check`
Expected: no error on either `router.push({ pathname: '/triage', params: { source: … } })`
call in Task 6. expo-router globs everything under `src/app/` into its route table, so the
sourcemap grep proves nothing for a route file — the evidence for a route is the caller's
diff plus the typed-route union `tsc` generates.

- [ ] **Step 9: Bundle**

Run:
```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/sources/calendar.ts' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```
Expected: clean export, and `1` or more for the grep.

- [ ] **Step 10: Commit**

```bash
git add src/components/triage-card.tsx src/app/triage/index.tsx
git commit -m "$(cat <<'EOF'
feat(triage): deal either source's deck, and write the source it dealt

The route takes a `source` param defaulting to contacts, so every existing link
keeps working. `cardsFor` picks the bucket: needsBirthday for contacts, ready for
calendars.

createPerson and skipContact were passing a hardcoded 'contacts'. That was the
likeliest defect in this whole step — it typechecks, it runs, and it files every
calendar person under contacts, so listExternalIdsBySource('calendar') finds none of
them and the same ten people get dealt again on every scan.

The draft is now seeded from the card during render rather than reset to empty on
advance. One place a card's draft comes from, so one card's edits cannot leak into
the next, and no frame is painted with the previous card's date still in the fields.

TriageCard's name becomes a text field when given onChangeName, which only the
calendar deck passes. Contacts names come from the address book and are already
right; calendar names are parsed out of event titles and need correcting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Device verification

Nothing above can answer these. A dev build is required — `expo-calendar` substitutes a stub
under Expo Go whose every method throws.

- [ ] **1. The birthdays appear, and read as people.** The import screen's calendar section
  shows roughly ten, and the deck's names are `Mãe`, `Pai`, `Breno`, `Luan`, `Jaque 💜∞` —
  not `Mãe's birthday`.
- [ ] **2. Hiding a calendar is reported, not silently absorbed.** Untick a calendar in
  **Samsung Calendar** (not Google Calendar — Samsung owns the `VISIBLE` column on the test
  device), return to the screen: the notice appears, names the calendar, and the count drops.
  Re-tick it and the count returns.
- [ ] **3. The UTC bug is really gone.** Save `Mãe` from the deck and open her in the People
  tab: **25 January**, not the 24th. Only a device in a negative-offset zone shows this end
  to end, and São Paulo is UTC−3.
- [ ] **4. The source is written correctly.** Save someone from the calendar deck, then
  reopen the import screen: the calendar count drops by one and the deck does not deal them
  again. (This is what a hardcoded `'contacts'` would break, and it would break *only* here.)
- [ ] **5. Skips persist per source.** Skip one `Pai's birthday`, save the other. Re-scan:
  the skipped one stays gone, the saved one is not re-dealt, and the "ask me again" offer
  appears under the calendar section with a count of 1. Tap it and the skipped one comes back.
- [ ] **6. Either permission can be denied without taking the other down.** Deny calendar
  access: the calendar section explains, and the contacts half still imports and triages.
  Then deny contacts and grant calendars: the contacts section explains, and the calendar
  half still works. This is the requirement the `import.tsx` restructure exists for.
- [ ] **7. The editable name does not fight the swipe.** Tap the name field on a calendar
  card, correct `Jaque 💜∞` to `Jaque`, save. Check the field takes focus without throwing
  the card, and that the corrected name is what got stored.
- [ ] **8. The contacts deck is unchanged.** Its cards still show a fixed heading, no text
  field, and swipe exactly as before. It was device-verified in step 6 and this step must not
  have moved it.

## Wrapping up

- [ ] **Update `AGENTS.md`** — add `npm run test:tz` to the Commands block and to the
  Verifying section, and note that the two zones check different things (London for DST
  transitions, São Paulo for UTC-decoded calendar dates).
- [ ] **Update `docs/00-design.md`** — mark step 7 done in the implementation order.
- [ ] **Use `superpowers:finishing-a-development-branch`** to decide how `feat/calendar-import`
  is integrated.
