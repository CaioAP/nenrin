# Triage Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn step 5's contacts read path into a usable import screen plus the swipe-driven
triage deck that fills in missing birthdays.

**Architecture:** Deck state is a pure module in `src/domain/triage.ts` — cards plus a cursor,
plus the swipe-threshold resolution, all testable in plain Node. Two screens consume it:
`src/app/import.tsx` presents the ready-import and the deck as separate decisions, and
`src/app/triage/index.tsx` deals the cards. Skips and refusals persist as rows in `skipped`,
distinguished by a new `kind` column, so reopening the deck resumes rather than re-dealing.

**Tech Stack:** React Native 0.86 / Expo SDK 57, expo-router, Drizzle + expo-sqlite,
react-native-gesture-handler 2.32, react-native-reanimated 4.5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-triage-deck-design.md`

## Global Constraints

- **`src/domain/` imports nothing from Expo, React Native, or the database.** Pure functions
  over plain objects.
- **Every database write goes through a repository function in `src/db/`.** No screen touches
  the database directly.
- **After changing `src/db/schema.ts`, run `npm run db:generate`.** The app applies the
  generated bundle, not the schema file.
- **`src/db/client.ts` calls `openDatabaseSync` at module scope**, so nothing importing
  `src/db/client` is Vitest-reachable. Only `src/db/mappers.ts` is unit-testable in that
  directory — it deliberately imports neither the client nor Expo.
- **Nothing in `src/components/` or `src/app/` has automated tests.** There is no React
  testing setup and adding one is out of scope. Those tasks are gated by `check`, `lint`,
  `expo export` and a device.
- **Tests pin `TZ=Europe/London`** via the npm scripts. Do not add a second time zone.
- Vitest `include` is `['src/domain/**/*.test.ts', 'src/db/**/*.test.ts', 'src/sources/**/*.test.ts']`.
  New test files must land under one of those globs or they silently never run.
- Biome owns formatting. Run `npm run lint:fix` before committing; there is no Prettier.
- **Never `import` `expo-notifications` at module scope.** Unrelated to this work, but it
  crashes the app in Expo Go on Android and the symptom names routes, not notifications.
- Commit messages: conventional commits, and end with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Persist the skip kind, and write imported people in bulk

**Files:**
- Modify: `src/domain/import.ts` (add `SkipKind`)
- Modify: `src/db/schema.ts:103-117` (the `skipped` table)
- Modify: `src/db/skipped.ts` (whole file)
- Modify: `src/db/mappers.ts` (add `toNewPersonFromCandidate`)
- Modify: `src/db/people.ts` (add `createFromCandidates`)
- Test: `src/db/mappers.test.ts`
- Generated: `drizzle/0002_*.sql`, `drizzle/meta/*`

**Interfaces:**
- Consumes: `ImportCandidate` from `src/domain/import.ts`; `NewPerson` from `src/db/mappers.ts`;
  `PersonSource` from `src/domain/person.ts`.
- Produces:
  - `type SkipKind = 'deferred' | 'refused'` (exported from `src/domain/import.ts`)
  - `skipContact(source: PersonSource, externalId: string, kind: SkipKind): Promise<void>`
  - `clearDeferred(source: PersonSource): Promise<number>` — returns rows deleted
  - `countDeferred(source: PersonSource): Promise<number>`
  - `listSkippedExternalIds(source: PersonSource): Promise<Set<string>>` — unchanged signature
  - `toNewPersonFromCandidate(candidate: ImportCandidate): NewPerson`
  - `createFromCandidates(candidates: readonly ImportCandidate[]): Promise<number>`

- [ ] **Step 1: Add the `SkipKind` type**

In `src/domain/import.ts`, below `HandledExternalIds`:

```ts
/**
 * Why a candidate is not in the deck.
 *
 * Both values keep a candidate out, so nothing reads them differently yet. The distinction
 * is recorded at write time because it cannot be reconstructed later: once rows exist
 * without it, "not now" and "never" are indistinguishable forever.
 */
export type SkipKind = 'deferred' | 'refused';
```

- [ ] **Step 2: Write the failing mapper test**

Append to `src/db/mappers.test.ts`:

```ts
describe('toNewPersonFromCandidate', () => {
  it('carries the external id and source so a re-import can de-duplicate', () => {
    const result = toNewPersonFromCandidate({
      externalId: 'c1',
      displayName: 'Ana Paula Silva',
      birthday: { month: 11, day: 25, year: null },
      source: 'contacts',
    });

    expect(result).toEqual({
      displayName: 'Ana Paula Silva',
      birthday: { month: 11, day: 25, year: null },
      source: 'contacts',
      externalId: 'c1',
    });
  });

  it('keeps a known year', () => {
    const result = toNewPersonFromCandidate({
      externalId: 'c2',
      displayName: 'Bruno Costa',
      birthday: { month: 6, day: 13, year: 1994 },
      source: 'contacts',
    });

    expect(result.birthday.year).toBe(1994);
  });

  it('throws on a candidate with no birthday, which is a caller bug', () => {
    expect(() =>
      toNewPersonFromCandidate({
        externalId: 'c3',
        displayName: 'Carla',
        birthday: null,
        source: 'contacts',
      }),
    ).toThrow();
  });
});
```

Add `toNewPersonFromCandidate` to the existing import from `./mappers` at the top of the
file, and `ImportCandidate` is not needed — the literals are structurally typed.

- [ ] **Step 3: Run the test and watch it fail**

```bash
npm test -- mappers
```

Expected: FAIL — `toNewPersonFromCandidate is not a function`.

Note: `src/db/mappers.ts` is the only file under `src/db/` that Vitest can load, because it
imports neither `./client` nor Expo. Keep it that way.

- [ ] **Step 4: Implement the mapper**

In `src/db/mappers.ts`, below `toNewPersonRow`:

```ts
/**
 * An import candidate as a person to write.
 *
 * Throws rather than skipping when the birthday is missing. The only valid input is the
 * `ready` bucket, which is *defined* by having one — a candidate without a birthday reaching
 * here means the caller passed the wrong bucket, and silently dropping it would hide that.
 */
export function toNewPersonFromCandidate(candidate: ImportCandidate): NewPerson {
  if (!candidate.birthday) {
    throw new Error(`Candidate ${candidate.externalId} has no birthday and cannot be imported`);
  }

  return {
    displayName: candidate.displayName,
    birthday: candidate.birthday,
    source: candidate.source,
    externalId: candidate.externalId,
  };
}
```

Add to the imports at the top of the file:

```ts
import type { ImportCandidate } from '@/domain/import';
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npm test -- mappers
```

Expected: PASS.

- [ ] **Step 6: Add the `kind` column to the schema**

In `src/db/schema.ts`, inside the `skipped` table definition, after `externalId`:

```ts
    /**
     * 'deferred' — skipped for now. 'refused' — don't ask again.
     *
     * Defaults to 'refused' because every row written before this column existed came from
     * the don't-ask-again path.
     */
    kind: text('kind').$type<SkipKind>().notNull().default('refused'),
```

Add `SkipKind` to the existing type import from `@/domain/import` — or create that import if
the file has none. `schema.ts` already imports `PersonSource` from `@/domain/person`, so
importing a type from the domain here is the established pattern.

- [ ] **Step 7: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `drizzle/0002_*.sql` containing an `ALTER TABLE` that adds `kind`, plus an
updated `drizzle/meta/_journal.json` and a new snapshot.

Open the generated `.sql` and confirm it is an `ALTER TABLE ... ADD COLUMN` with the
`'refused'` default — **not** a table drop and recreate. If drizzle-kit produced a
destructive recreate, stop and report it; it would erase existing refusals.

- [ ] **Step 8: Rewrite `src/db/skipped.ts`**

Replace the whole file:

```ts
/**
 * The contacts the triage deck should not ask about, and why.
 *
 * Keyed on source and external id rather than on a person, because the whole point is that
 * no person row exists — see the table's own comment in `schema.ts`. Without this, every
 * re-import replays the entire address book.
 */

import { and, count, eq } from 'drizzle-orm';

import type { SkipKind } from '@/domain/import';
import type { PersonSource } from '@/domain/person';
import { db } from './client';
import { skipped } from './schema';

/**
 * Every external id from this source the deck should pass over — both kinds.
 *
 * Deliberately does not distinguish them. A deferred candidate and a refused one are equally
 * "not in the deck right now"; only `clearDeferred` cares which is which.
 */
export async function listSkippedExternalIds(source: PersonSource): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: skipped.externalId })
    .from(skipped)
    .where(eq(skipped.source, source));

  return new Set(rows.map((row) => row.externalId));
}

/**
 * Records a skip or a refusal. Idempotent — the primary key is the source/id pair, so
 * skipping something already skipped is not an error.
 *
 * `onConflictDoUpdate` rather than `DoNothing`: refusing a contact previously deferred must
 * upgrade the row, or "don't ask again" would silently do nothing the second time round.
 */
export async function skipContact(
  source: PersonSource,
  externalId: string,
  kind: SkipKind,
): Promise<void> {
  await db
    .insert(skipped)
    .values({ source, externalId, kind })
    .onConflictDoUpdate({
      target: [skipped.source, skipped.externalId],
      set: { kind },
    });
}

/** How many candidates are merely deferred, for the "ask me again" offer. */
export async function countDeferred(source: PersonSource): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(skipped)
    .where(and(eq(skipped.source, source), eq(skipped.kind, 'deferred')));

  return row?.total ?? 0;
}

/**
 * Puts every deferred candidate back in the deck. Refusals are untouched — that is the
 * whole distinction, and the only place in the app that reads `kind`.
 */
export async function clearDeferred(source: PersonSource): Promise<number> {
  const deleted = await db
    .delete(skipped)
    .where(and(eq(skipped.source, source), eq(skipped.kind, 'deferred')))
    .returning({ externalId: skipped.externalId });

  return deleted.length;
}
```

- [ ] **Step 9: Add the bulk write**

In `src/db/people.ts`, at the end of the file:

```ts
/**
 * Writes every ready candidate as a person, in one transaction.
 *
 * One transaction rather than a loop of `createPerson` from the screen: a failure halfway
 * through an address book should write nobody, not half of them. The candidate → row
 * conversion lives in `mappers.ts` because `src/domain/` may not import `NewPerson`.
 *
 * Only the `ready` bucket is valid input — `toNewPersonFromCandidate` throws on a candidate
 * with no birthday rather than skipping it, so passing the wrong bucket fails loudly.
 */
export async function createFromCandidates(
  candidates: readonly ImportCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  const now = new Date();
  const rows = candidates.map((candidate) =>
    toNewPersonRow(toNewPersonFromCandidate(candidate), randomUUID(), now),
  );

  await db.insert(person).values(rows);
  return rows.length;
}
```

Extend the existing imports in that file:

```ts
import type { ImportCandidate } from '@/domain/import';
import { toNewPersonFromCandidate, toNewPersonRow, /* …existing… */ } from './mappers';
```

`toNewPersonRow` and `randomUUID` are already imported in `people.ts` — check before adding
duplicates.

- [ ] **Step 10: Run every gate**

```bash
npm run check && npm run lint && npm test
```

Expected: all clean. Test count rises by 3 from the mapper tests.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(db): tell a deferred contact from a refused one

The deck must not re-deal the cards you already skipped, so a skip now
writes a row like a refusal does, distinguished by kind. Nothing reads
the two differently yet — both keep a candidate out of the deck. The
column earns its place at write time because the distinction cannot be
reconstructed afterwards: once rows exist without it, 'not now' and
'never' are indistinguishable forever.

clearDeferred is what makes it load-bearing on arrival, and closes a
dead end: defer everyone and the deck would otherwise be empty for good.

createFromCandidates writes the ready bucket in one transaction, so a
failure part-way through an address book writes nobody rather than half.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The deck as a pure module

**Files:**
- Create: `src/domain/triage.ts`
- Test: `src/domain/triage.test.ts`

**Interfaces:**
- Consumes: `ImportCandidate` from `src/domain/import.ts`.
- Produces:
  - `type TriageAction = 'save' | 'defer' | 'refuse'`
  - `type DeckState = { readonly cards: readonly ImportCandidate[]; readonly cursor: number }`
  - `makeDeck(candidates: readonly ImportCandidate[]): DeckState`
  - `currentCard(state: DeckState): ImportCandidate | null`
  - `advance(state: DeckState): DeckState`
  - `progress(state: DeckState): { done: number; total: number }`
  - `resolveSwipe(input: { translationX: number; canSave: boolean }): SwipeOutcome`
  - `type SwipeOutcome = 'save' | 'defer' | 'blocked' | 'none'`
  - `const SWIPE_THRESHOLD = 96`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/triage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ImportCandidate } from './import';
import {
  advance,
  currentCard,
  makeDeck,
  progress,
  resolveSwipe,
  SWIPE_THRESHOLD,
} from './triage';

const candidate = (externalId: string): ImportCandidate => ({
  externalId,
  displayName: `Person ${externalId}`,
  birthday: null,
  source: 'contacts',
});

const deckOf = (...ids: string[]) => makeDeck(ids.map(candidate));

describe('makeDeck', () => {
  it('starts on the first card', () => {
    const state = deckOf('a', 'b', 'c');
    expect(currentCard(state)?.externalId).toBe('a');
    expect(progress(state)).toEqual({ done: 0, total: 3 });
  });

  it('is immediately exhausted when there is nothing to deal', () => {
    const state = makeDeck([]);
    expect(currentCard(state)).toBeNull();
    expect(progress(state)).toEqual({ done: 0, total: 0 });
  });
});

describe('advance', () => {
  it('moves to the next card', () => {
    const state = advance(deckOf('a', 'b', 'c'));
    expect(currentCard(state)?.externalId).toBe('b');
    expect(progress(state)).toEqual({ done: 1, total: 3 });
  });

  it('reports exhaustion after the last card, not before it', () => {
    let state = deckOf('a', 'b');
    state = advance(state);
    expect(currentCard(state)?.externalId).toBe('b');

    state = advance(state);
    expect(currentCard(state)).toBeNull();
    expect(progress(state)).toEqual({ done: 2, total: 2 });
  });

  it('never runs the cursor past the end, however hard it is pushed', () => {
    let state = deckOf('a');
    for (let i = 0; i < 5; i += 1) state = advance(state);

    expect(currentCard(state)).toBeNull();
    expect(progress(state)).toEqual({ done: 1, total: 1 });
  });

  it('does not mutate the state it was given', () => {
    const state = deckOf('a', 'b');
    advance(state);
    expect(currentCard(state)?.externalId).toBe('a');
  });
});

describe('resolveSwipe', () => {
  it('saves on a decisive right swipe when the draft is complete', () => {
    expect(resolveSwipe({ translationX: SWIPE_THRESHOLD + 1, canSave: true })).toBe('save');
  });

  it('defers on a decisive left swipe', () => {
    expect(resolveSwipe({ translationX: -SWIPE_THRESHOLD - 1, canSave: false })).toBe('defer');
  });

  it('blocks a right swipe when there is nothing to save', () => {
    // Not 'none'. The card must visibly refuse — a gesture that does nothing is
    // indistinguishable from one that missed.
    expect(resolveSwipe({ translationX: SWIPE_THRESHOLD + 1, canSave: false })).toBe('blocked');
  });

  it('defers left even with an incomplete draft, because skipping needs no date', () => {
    expect(resolveSwipe({ translationX: -SWIPE_THRESHOLD - 1, canSave: false })).toBe('defer');
  });

  it('does nothing for a drag that never reaches the threshold', () => {
    expect(resolveSwipe({ translationX: SWIPE_THRESHOLD - 1, canSave: true })).toBe('none');
    expect(resolveSwipe({ translationX: -SWIPE_THRESHOLD + 1, canSave: true })).toBe('none');
    expect(resolveSwipe({ translationX: 0, canSave: true })).toBe('none');
  });

  it('treats exactly the threshold as not yet decisive', () => {
    expect(resolveSwipe({ translationX: SWIPE_THRESHOLD, canSave: true })).toBe('none');
    expect(resolveSwipe({ translationX: -SWIPE_THRESHOLD, canSave: true })).toBe('none');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- triage
```

Expected: FAIL — cannot resolve `./triage`.

If instead you see "No test files found", the Vitest `include` glob is wrong; the file must
be at `src/domain/triage.test.ts`.

- [ ] **Step 3: Implement the module**

Create `src/domain/triage.ts`:

```ts
/**
 * The triage deck: which card is showing, and what a swipe means.
 *
 * This is screen logic, but it is pure screen logic, so it lives here rather than inside a
 * component where it could only be checked by swiping through four hundred cards on a
 * phone. `draft.ts` is here for the same reason.
 *
 * The rules that matter all fail quietly: a cursor that runs one past the end of 431 cards,
 * a resume that lands a card early, a swipe that commits when it should refuse. None of
 * those announce themselves on a device.
 */

import type { ImportCandidate } from './import';

/** What the user did to a card. Maps onto one write each. */
export type TriageAction = 'save' | 'defer' | 'refuse';

/**
 * Cards plus a cursor, rather than a queue that shifts.
 *
 * `progress` is then free, and "back one card" would be a subtraction. Exhaustion is
 * `cursor === cards.length` and nothing else — there is no second flag that could disagree.
 */
export type DeckState = {
  readonly cards: readonly ImportCandidate[];
  readonly cursor: number;
};

export function makeDeck(candidates: readonly ImportCandidate[]): DeckState {
  return { cards: candidates, cursor: 0 };
}

/** The card on top, or null when the deck is spent. */
export function currentCard(state: DeckState): ImportCandidate | null {
  return state.cards[state.cursor] ?? null;
}

/**
 * Moves to the next card. Clamped: advancing an exhausted deck is a no-op rather than a
 * cursor that keeps climbing past the end.
 */
export function advance(state: DeckState): DeckState {
  if (state.cursor >= state.cards.length) return state;
  return { cards: state.cards, cursor: state.cursor + 1 };
}

export function progress(state: DeckState): { done: number; total: number } {
  return { done: state.cursor, total: state.cards.length };
}

/**
 * How far the card must travel before a release commits, in points.
 *
 * Far enough that a hesitant drag springs back, short enough that a flick across a phone
 * clears it comfortably.
 */
export const SWIPE_THRESHOLD = 96;

/**
 * `'blocked'` is the one that matters: a right swipe with no date entered must visibly
 * refuse, not quietly do nothing. Silence there is indistinguishable from a missed gesture,
 * and the user learns the swipe is unreliable rather than that the card is incomplete.
 */
export type SwipeOutcome = 'save' | 'defer' | 'blocked' | 'none';

export function resolveSwipe(input: { translationX: number; canSave: boolean }): SwipeOutcome {
  if (input.translationX > SWIPE_THRESHOLD) return input.canSave ? 'save' : 'blocked';
  if (input.translationX < -SWIPE_THRESHOLD) return 'defer';
  return 'none';
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm test -- triage
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Mutation-test the clamp**

A passing test proves nothing until you have seen it fail. Temporarily change `advance` to
drop its guard:

```ts
export function advance(state: DeckState): DeckState {
  return { cards: state.cards, cursor: state.cursor + 1 };
}
```

Run `npm test -- triage`. Expected: the "never runs the cursor past the end" test FAILS.
Restore the guard and confirm it passes again.

- [ ] **Step 6: Run every gate and commit**

```bash
npm run check && npm run lint && npm test
```

```bash
git add src/domain/triage.ts src/domain/triage.test.ts
git commit -m "feat(domain): deal a triage deck and read a swipe

Cards plus a cursor, kept pure so the rules that fail quietly can be
checked without a phone: a cursor that runs one past the end of 431
cards, a resume that lands a card early, a swipe that commits when it
should refuse.

resolveSwipe returns 'blocked' rather than 'none' for a right swipe with
nothing to save. The card has to visibly refuse — a gesture that does
nothing is indistinguishable from one that missed, and the user learns
the swipe is unreliable instead of that the card is incomplete.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the scan both screens need

**Files:**
- Create: `src/hooks/use-contact-scan.ts`
- Modify: `src/components/debug-tools.tsx` (replace the body of `scanContacts`)

**Interfaces:**
- Consumes: `contactsSource` from `src/sources/contacts.ts`; `partitionCandidates` and
  `Partitioned` from `src/domain/import.ts`; `listExternalIdsBySource` from `src/db/people.ts`;
  `listSkippedExternalIds` from `src/db/skipped.ts`; `AccessLevel` from `src/sources/types.ts`.
- Produces:
  - `type ScanResult = { access: AccessLevel; partitioned: Partitioned }`
  - `scanContacts(): Promise<ScanResult>` — a plain async function, not a hook
  - `type ContactScan = { state: 'scanning' } | { state: 'ready'; result: ScanResult } | { state: 'failed'; error: Error }`
  - `useContactScan(): { scan: ContactScan; rescan: () => void }`

**Behavioural note:** this task changes no behaviour. It moves an existing sequence so two
callers share one copy. The debug button must still print exactly what it printed before.

- [ ] **Step 1: Create the hook module**

Create `src/hooks/use-contact-scan.ts`:

```ts
/**
 * One scan of the address book, shared by the import screen and the debug panel.
 *
 * The sequence — request access, fetch, read both handled sets, partition — was written
 * once in the debug panel and is now needed for real. Two copies would drift, and the one
 * that drifted would be the one nobody was watching.
 */

import { useCallback, useEffect, useState } from 'react';

import { listExternalIdsBySource } from '@/db/people';
import { listSkippedExternalIds } from '@/db/skipped';
import { type Partitioned, partitionCandidates } from '@/domain/import';
import { contactsSource } from '@/sources/contacts';
import type { AccessLevel } from '@/sources/types';

export type ScanResult = {
  access: AccessLevel;
  partitioned: Partitioned;
};

const NOTHING: Partitioned = { ready: [], needsBirthday: [], alreadyKnown: [] };

/**
 * Runs the whole read path once.
 *
 * Access denied returns empty buckets rather than throwing. The app must stay fully usable
 * with contacts refused, so "no" is an ordinary answer here, not an error.
 */
export async function scanContacts(): Promise<ScanResult> {
  const access = await contactsSource.requestAccess();
  if (access === 'none') return { access, partitioned: NOTHING };

  const candidates = await contactsSource.fetchCandidates();
  const [imported, skipped] = await Promise.all([
    listExternalIdsBySource('contacts'),
    listSkippedExternalIds('contacts'),
  ]);

  return { access, partitioned: partitionCandidates(candidates, { imported, skipped }) };
}

export type ContactScan =
  | { state: 'scanning' }
  | { state: 'ready'; result: ScanResult }
  | { state: 'failed'; error: Error };

/**
 * The same scan as a screen state machine.
 *
 * `rescan` exists because both screens change what the scan would return — importing the
 * ready bucket, or handling a card — and a stale count on screen is worse than a spinner.
 */
export function useContactScan(): { scan: ContactScan; rescan: () => void } {
  const [scan, setScan] = useState<ContactScan>({ state: 'scanning' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setScan({ state: 'scanning' });

    scanContacts()
      .then((result) => {
        if (!cancelled) setScan({ state: 'ready', result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScan({ state: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
        }
      });

    // Guards against a scan of four hundred contacts resolving after the screen is gone.
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const rescan = useCallback(() => setNonce((n) => n + 1), []);

  return { scan, rescan };
}
```

- [ ] **Step 2: Rewire the debug panel to use it**

In `src/components/debug-tools.tsx`, replace the body of the local `scanContacts` function
so it calls the shared one. Rename the local function to `runContactScan` to avoid shadowing
the import, and update the `ActionButton`'s `onPress` to match:

```tsx
async function runContactScan(): Promise<string> {
  const { access, partitioned } = await scanContacts();
  if (access === 'none') {
    // Not an error path. The app must stay fully usable with contacts denied.
    return 'Access: none. Nothing scanned, nothing thrown — which is the point.';
  }

  const { ready, needsBirthday, alreadyKnown } = partitioned;
  const total = ready.length + needsBirthday.length + alreadyKnown.length;

  const withBirthday = ready
    .slice(0, SCAN_SAMPLE_LIMIT)
    .flatMap((candidate) => {
      // `ready` is defined by having a birthday, so this never drops anything. It is a
      // flatMap rather than a `?? { month: 0 }` fallback because a fallback that fired
      // would print 0/0 as though it were data the phone gave us.
      const birthday = candidate.birthday;
      if (!birthday) return [];
      const { month, day, year } = birthday;
      return [`  ${candidate.displayName} — ${day}/${month}${year ? `/${year}` : ''}`];
    })
    .join('\n');

  return [
    `Access: ${access}`,
    `${total} candidates named`,
    `  ready: ${ready.length}`,
    `  needsBirthday: ${needsBirthday.length}`,
    `  alreadyKnown: ${alreadyKnown.length}`,
    '',
    // Printed day/month so a month-base error is visible rather than plausible.
    withBirthday || 'No candidate carried a birthday.',
  ].join('\n');
}
```

Add the import:

```ts
import { scanContacts } from '@/hooks/use-contact-scan';
```

Then delete from `debug-tools.tsx` the imports that are now unused — `contactsSource`,
`listExternalIdsBySource`, `listSkippedExternalIds`, `partitionCandidates`. Biome will fail
the lint if any are left behind.

**Keep `probeContacts` and its `PROBE_FIELDS` exactly as they are.** It reads raw SDK shapes
and answers a different question; it must not go through the adapter.

The old version printed `db sets — imported: N, skipped: N`. That line goes: the hook no
longer surfaces the raw sets, and the counts it reported are recoverable from
`alreadyKnown`. Note this in the commit message so the change is not mistaken for a bug.

- [ ] **Step 3: Run every gate**

```bash
npm run check && npm run lint && npm test
```

Expected: all clean, test count unchanged.

- [ ] **Step 4: Prove it still bundles**

```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/hooks/use-contact-scan.ts' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```

Expected: exit 0, and the grep prints a non-zero count.

Do not grep the `.hbc` itself for a function name — minification renames them, so a module
that is plainly present looks absent.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sources): share one contact scan between callers

The request-fetch-partition sequence was written inside the debug panel
and is now needed by the import screen. Two copies would drift, and the
one that drifted would be the one nobody was watching.

No behaviour change, with one visible exception: the debug output drops
its 'db sets' line, because the hook no longer surfaces the raw sets and
the counts are recoverable from alreadyKnown.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The import screen

**Files:**
- Create: `src/app/import.tsx`
- Modify: `src/app/_layout.tsx:61-67` (register the route)
- Modify: `src/app/(tabs)/settings.tsx` (add the entry point)

**Interfaces:**
- Consumes: `useContactScan` from `src/hooks/use-contact-scan.ts`; `createFromCandidates`
  from `src/db/people.ts`; `countDeferred` and `clearDeferred` from `src/db/skipped.ts`;
  `ActionButton`, `ThemedText`, `ThemedView`; `Spacing` from `src/constants/theme.ts`.
- Produces: the route `/import`, linked from Settings, from which `/triage` is reached.

- [ ] **Step 1: Create the screen**

Create `src/app/import.tsx`:

```tsx
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createFromCandidates } from '@/db/people';
import { clearDeferred, countDeferred } from '@/db/skipped';
import { useContactScan } from '@/hooks/use-contact-scan';

/**
 * Where an import starts.
 *
 * The two decisions are presented separately and never nested. Importing the handful of
 * contacts that already carry a birthday is free and instant; filling in the hundreds that
 * do not is real work. Putting both behind one button would either do the work unasked or
 * hide the free win behind it.
 */
export default function ImportScreen() {
  const router = useRouter();
  const { scan, rescan } = useContactScan();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [deferred, setDeferred] = useState(0);

  // Read alongside every scan, because "ask me again" must disappear the moment it is used
  // and reappear the moment the deck defers something.
  useEffect(() => {
    let cancelled = false;
    countDeferred('contacts').then((total) => {
      if (!cancelled) setDeferred(total);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    rescan();
    countDeferred('contacts').then(setDeferred);
  }, [rescan]);

  if (scan.state === 'scanning') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Reading your contacts…</ThemedText>
      </ThemedView>
    );
  }

  if (scan.state === 'failed') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ThemedText type="subtitle">Could not read your contacts</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          {scan.error.message}
        </ThemedText>
        <ActionButton label="Try again" onPress={refresh} />
      </ThemedView>
    );
  }

  const { access, partitioned } = scan.result;

  if (access === 'none') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ThemedText type="subtitle">Contacts are off</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          Nenrin cannot read your address book. Everything else still works — you can add
          people by hand, and turn contacts on later in your device settings.
        </ThemedText>
        <ActionButton label="Check again" onPress={refresh} />
      </ThemedView>
    );
  }

  const { ready, needsBirthday } = partitioned;

  const importReady = async () => {
    if (importing) return;
    setImporting(true);
    try {
      setImported(await createFromCandidates(ready));
      refresh();
    } finally {
      // Cleared even on failure, or a rejected write would leave the button dead forever.
      setImporting(false);
    }
  };

  const askAgain = async () => {
    await clearDeferred('contacts');
    refresh();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Import' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {access === 'limited' ? (
          <ThemedText type="small" themeColor="textSecondary">
            You have shared some of your contacts with Nenrin, not all of them. These counts
            cover only what you shared.
          </ThemedText>
        ) : null}

        <View style={styles.section}>
          <ThemedText type="subtitle">
            {ready.length === 0
              ? 'None of your contacts have a birthday saved'
              : `${describeContacts(ready.length)} already ${ready.length === 1 ? 'has' : 'have'} a birthday`}
          </ThemedText>
          {ready.length > 0 ? (
            <ActionButton
              label={importing ? 'Importing…' : `Import ${ready.length === 1 ? 'this one' : `these ${ready.length}`}`}
              onPress={importReady}
              disabled={importing}
            />
          ) : null}
          {imported !== null ? (
            <ThemedText type="small" themeColor="textSecondary">
              {imported === 0 ? 'Nothing new to add.' : `Added ${describeContacts(imported)}.`}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <ThemedText type="subtitle">
            {needsBirthday.length === 0
              ? 'Nothing left to go through'
              : `${describeContacts(needsBirthday.length)} ${needsBirthday.length === 1 ? 'has' : 'have'} none`}
          </ThemedText>
          {needsBirthday.length > 0 ? (
            <>
              <ThemedText themeColor="textSecondary">
                Nenrin can ask you about them one at a time. Skip anyone you do not know —
                you can always come back.
              </ThemedText>
              <ActionButton label="Start" onPress={() => router.push('/triage')} />
            </>
          ) : null}
        </View>

        {deferred > 0 ? (
          <View style={styles.section}>
            <ActionButton
              label={`Ask me again about the ${deferred} I skipped`}
              onPress={askAgain}
            />
          </View>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">
          Birthdays you add here are saved in Nenrin only. Your contacts are never changed.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function describeContacts(count: number): string {
  return `${count} contact${count === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  section: { gap: Spacing.two, alignItems: 'flex-start' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#8884' },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
```

`ActionButton` with `router.push` rather than a `Link`-wrapped `Pressable`: the link form
would need its own button styling reproduced from `ActionButton`, and two copies of the same
filled-button look drift. `useRouter` is already how nothing else in this app navigates —
the existing screens all use `Link` for row taps — but a filled call-to-action is exactly
what `ActionButton` is for.

- [ ] **Step 2: Register the route**

In `src/app/_layout.tsx`, inside `<Stack>`, after the `person/[id]` screen:

```tsx
      <Stack.Screen name="import" />
```

- [ ] **Step 3: Link it from Settings**

In `src/app/(tabs)/settings.tsx`, add a section above `<DebugTools />`:

```tsx
        <Section
          title="Add people"
          hint="Bring in birthdays your phone already knows, and fill in the ones it does not."
        >
          <ActionButton label="Import from contacts" onPress={() => router.push('/import')} />
        </Section>
```

`Section` at `settings.tsx:213` takes `children: React.ReactNode` and renders them inside a
plain `View`, so a button is as valid as the chip rows it holds elsewhere.

Add to the top of `SettingsScreen`:

```tsx
  const router = useRouter();
```

and extend the imports with `useRouter` from `expo-router` and `ActionButton` from
`@/components/action-button`.

- [ ] **Step 4: Run every gate**

```bash
npm run check && npm run lint && npm test
```

- [ ] **Step 5: Prove the route bundles**

```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/app/import.tsx' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```

Expected: non-zero.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(import): offer the free win and the work separately

Two decisions, never nested. Importing the contacts that already carry a
birthday is instant; filling in the hundreds that do not is real work.
One button would either do the work unasked or hide the free win behind
it.

Covers the states a device actually produces: scanning, denied, limited
access on iOS 18, and nothing left to do. Denied is an ordinary answer
here rather than an error — the app has to stay fully usable with
contacts refused.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The card

**Files:**
- Create: `src/components/triage-card.tsx`
- Modify: `src/app/_layout.tsx` (wrap in `GestureHandlerRootView`)

**Interfaces:**
- Consumes: `resolveSwipe`, `SWIPE_THRESHOLD`, `TriageAction` from `src/domain/triage.ts`;
  `PersonDraft`, `parsePersonDraft`, `EMPTY_PERSON_DRAFT` from `src/domain/draft.ts`;
  `MONTH_NAMES` from `src/domain/format.ts`; `isValidMonthDay` from `src/domain/birthday.ts`;
  `Chip`, `ThemedText`; `useTheme`.
- Produces:
  - `TriageCard` — props `{ displayName: string; draft: PersonDraft; onChangeDraft: (next: PersonDraft) => void; onAction: (action: TriageAction) => void; canSave: boolean; error: string | null; onBlocked: () => void }`

- [ ] **Step 1: Add `GestureHandlerRootView` to the root layout**

In `src/app/_layout.tsx`, import it and wrap the returned tree of `RootLayout`:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
```

```tsx
  return (
    /*
     * Required for any gesture below this point. Without it pan gestures silently do
     * nothing on Android — no warning, no error, and check, lint, test and expo export all
     * pass. expo-router re-exports this component for react-navigation's own stack
     * internals, which is not the same as wrapping the app root.
     */
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={navigationTheme(colorScheme === 'dark' ? 'dark' : 'light')}>
        {error ? <MigrationFailed error={error} /> : success ? <AppStack /> : <Starting />}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
```

Add to the stylesheet at the bottom of that file:

```ts
  root: { flex: 1 },
```

`flex: 1` is not optional — without it the view collapses to zero height and the entire app
renders blank.

- [ ] **Step 2: Build the card**

Create `src/components/triage-card.tsx`:

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { isValidMonthDay } from '@/domain/birthday';
import type { PersonDraft } from '@/domain/draft';
import { MONTH_NAMES } from '@/domain/format';
import { resolveSwipe, SWIPE_THRESHOLD, type TriageAction } from '@/domain/triage';
import { useTheme } from '@/hooks/use-theme';
import { Chip } from './chip';
import { ThemedText } from './themed-text';

/** How far a blocked swipe is allowed to travel before it stops dead. */
const BLOCKED_CLAMP = 24;

/**
 * One person to answer for.
 *
 * Month and day are grids rather than the scrolling chip rows the add form uses, and that
 * is the whole reason this component exists instead of reusing `BirthdayFields`. A
 * horizontal swipe starting on a horizontally scrolling row is ambiguous — scroll the row,
 * or throw the card? A grid has no horizontal scroll, so the axis belongs entirely to the
 * gesture and there is nothing to arbitrate. Tapping the 25th directly is fewer
 * interactions than scrolling to find it, too.
 *
 * Every gesture also has a button. A swipe cannot be performed by a screen reader, and
 * gesture-only actions would make the deck unusable with TalkBack and VoiceOver.
 */
export function TriageCard({
  displayName,
  draft,
  onChangeDraft,
  onAction,
  canSave,
  error,
  onBlocked,
}: {
  displayName: string;
  draft: PersonDraft;
  onChangeDraft: (next: PersonDraft) => void;
  onAction: (action: TriageAction) => void;
  canSave: boolean;
  /** Shown when a save was attempted with an incomplete date. */
  error: string | null;
  onBlocked: () => void;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  // Collapsed by default. Most birthdays you know are day and month only, and a year field
  // sitting open invites people to invent one.
  const [showYear, setShowYear] = useState(false);

  const commit = (action: TriageAction) => {
    translateX.value = 0;
    onAction(action);
  };

  const pan = Gesture.Pan()
    // Arms only on a decisive horizontal drag, so a vertical scroll never throws the card.
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      const wantsSave = event.translationX > 0;
      translateX.value =
        wantsSave && !canSave
          ? Math.min(event.translationX, BLOCKED_CLAMP)
          : event.translationX;
    })
    .onEnd((event) => {
      const outcome = resolveSwipe({ translationX: event.translationX, canSave });

      if (outcome === 'save' || outcome === 'defer') {
        // Off-screen in the direction of travel, then the parent swaps in the next card.
        translateX.value = withTiming(outcome === 'save' ? 600 : -600, { duration: 160 }, () => {
          runOnJS(commit)(outcome === 'save' ? 'save' : 'defer');
        });
        return;
      }

      translateX.value = withSpring(0);
      if (outcome === 'blocked') runOnJS(onBlocked)();
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const days = useMemo(() => {
    // February offers 29 so leap-day birthdays are enterable; the domain decides where a
    // 29 February lands in a common year, not this picker.
    const length = draft.month === null ? 31 : draft.month === 2 ? 29 : monthLength(draft.month);
    return Array.from({ length }, (_, i) => i + 1);
  }, [draft.month]);

  const selectMonth = (month: number) => {
    // A day the new month cannot hold is cleared rather than silently coerced to the 28th.
    const keepsDay = draft.day !== null && isValidMonthDay(month, draft.day);
    onChangeDraft({ ...draft, month, day: keepsDay ? draft.day : null });
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, { backgroundColor: theme.backgroundElement }, cardStyle]}>
        <ThemedText type="subtitle">{displayName}</ThemedText>

        <ThemedText type="smallBold">Month</ThemedText>
        <View style={styles.grid}>
          {MONTH_NAMES.map((name, index) => (
            <Chip
              key={name}
              label={name.slice(0, 3)}
              accessibilityLabel={name}
              selected={draft.month === index + 1}
              onPress={() => selectMonth(index + 1)}
            />
          ))}
        </View>

        <ThemedText type="smallBold">Day</ThemedText>
        <View style={styles.grid}>
          {days.map((day) => (
            <Chip
              key={day}
              label={String(day)}
              selected={draft.day === day}
              onPress={() => onChangeDraft({ ...draft, day })}
            />
          ))}
        </View>

        {showYear ? (
          <TextInput
            value={draft.year}
            onChangeText={(year) =>
              onChangeDraft({ ...draft, year: year.replace(/\D/g, '').slice(0, 4) })
            }
            placeholder="Year"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            accessibilityLabel="Birth year, optional"
            style={[styles.year, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowYear(true)}>
            <ThemedText type="small" themeColor="textSecondary">
              + year (optional)
            </ThemedText>
          </Pressable>
        )}

        {error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Skip ${displayName} for now`}
            onPress={() => commit('defer')}
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Skip
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Never ask about ${displayName} again`}
            onPress={() => commit('refuse')}
          >
            <ThemedText type="small" themeColor="textSecondary">
              Don't ask again
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Save ${displayName}'s birthday`}
            accessibilityState={{ disabled: !canSave }}
            onPress={() => (canSave ? commit('save') : onBlocked())}
          >
            <ThemedText type="smallBold" themeColor={canSave ? 'text' : 'textSecondary'}>
              Save →
            </ThemedText>
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

function monthLength(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  year: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
    minWidth: 96,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.three,
  },
});
```

`Spacing.one` is 4pt — confirmed against `src/constants/theme.ts`, which defines
`half | one | two | three | four | five | six`.

The year stays collapsed behind `+ year (optional)` rather than sitting open. Most birthdays
you know are day and month only, and an open year field invites people to invent one — which
is the entry friction this app exists to remove.

- [ ] **Step 3: Run every gate**

```bash
npm run check && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(triage): a card you can swipe, with grids that let you

Month and day are grids rather than the add form's scrolling chip rows,
and that is the whole reason this is a separate component. A horizontal
swipe starting on a horizontally scrolling row is ambiguous — scroll the
row, or throw the card? A grid has no horizontal scroll, so the axis is
the gesture's and there is nothing to arbitrate.

A right swipe with no date clamps and springs back rather than doing
nothing, because a dead gesture is indistinguishable from a missed one.

GestureHandlerRootView goes into the root layout here. Without it pan
gestures silently do nothing on Android, and check, lint, test and expo
export all pass regardless.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The deck screen

**Files:**
- Create: `src/app/triage/index.tsx`
- Modify: `src/app/_layout.tsx` (register the route)

**Interfaces:**
- Consumes: everything produced by Tasks 1, 2, 3 and 5.
- Produces: the route `/triage`.

- [ ] **Step 1: Build the screen**

Create `src/app/triage/index.tsx`:

```tsx
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TriageCard } from '@/components/triage-card';
import { Spacing } from '@/constants/theme';
import { createPerson } from '@/db/people';
import { skipContact } from '@/db/skipped';
import { EMPTY_PERSON_DRAFT, parsePersonDraft, type PersonDraft } from '@/domain/draft';
import { advance, currentCard, makeDeck, progress, type TriageAction } from '@/domain/triage';
import { useContactScan } from '@/hooks/use-contact-scan';
import { useTheme } from '@/hooks/use-theme';

/**
 * The deck.
 *
 * Re-scans on mount rather than receiving four hundred candidates through router params:
 * that keeps the route deep-linkable and correct after the app has been backgrounded for a
 * week, and passing that much through navigation state is not what it is for.
 *
 * Every action writes immediately. Batching to the end would mean fewer writes and forty
 * ways to lose forty cards of work.
 */
export default function TriageScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { scan } = useContactScan();
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deck = useMemo(() => {
    if (scan.state !== 'ready') return null;
    return makeDeck(scan.result.partitioned.needsBirthday);
  }, [scan]);

  if (scan.state === 'scanning' || !deck) {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const state = { cards: deck.cards, cursor };
  const card = currentCard(state);
  const peek = currentCard(advance(state));
  const { done, total } = progress(state);

  if (!card) {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ThemedText type="subtitle">
          {total === 0 ? 'Nothing to go through' : 'That is everyone'}
        </ThemedText>
        <ActionButton label="Done" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  const parsed = parsePersonDraft({ ...draft, displayName: card.displayName }, new Date().getFullYear());
  const canSave = parsed.ok;

  const nextCard = () => {
    setCursor(advance(state).cursor);
    setDraft(EMPTY_PERSON_DRAFT);
    setError(null);
  };

  const handle = async (action: TriageAction) => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'save') {
        if (!parsed.ok) return;
        await createPerson({
          displayName: parsed.value.displayName,
          birthday: parsed.value.birthday,
          source: 'contacts',
          externalId: card.externalId,
        });
      } else {
        await skipContact('contacts', card.externalId, action === 'refuse' ? 'refused' : 'deferred');
      }
      nextCard();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `${done} of ${total}` }} />
      <View style={styles.deck}>
        {/*
          * A glimpse of who is next, so the deck reads as a stack rather than one card that
          * keeps changing its name. Deliberately not a second `TriageCard`: that would mount
          * a second `GestureDetector` under the live one and put two pan handlers in the
          * same place. This is inert scenery.
          */}
        {peek ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.peek, { backgroundColor: theme.backgroundElement }]}
          >
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {peek.displayName}
            </ThemedText>
          </View>
        ) : null}

        <TriageCard
          key={card.externalId}
          displayName={card.displayName}
          draft={draft}
          onChangeDraft={setDraft}
          onAction={handle}
          canSave={canSave}
          error={error}
          onBlocked={() => setError('Pick a month and a day first.')}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  deck: { flex: 1, justifyContent: 'center', padding: Spacing.three },
  peek: {
    position: 'absolute',
    left: Spacing.five,
    right: Spacing.five,
    top: Spacing.three,
    borderRadius: 12,
    padding: Spacing.three,
    opacity: 0.6,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
});
```

The peek uses `advance(state)` to look ahead rather than indexing `cards` by hand, so the
end-of-deck clamp is the same code path as everything else — at the last card `advance`
returns an exhausted state and `currentCard` gives null, which is exactly what should render
no peek.

`key={card.externalId}` on the card is load-bearing: it forces a fresh component per person,
so the previous card's `translateX` cannot leak into the next one and leave it drawn
off-screen.

- [ ] **Step 2: Register the route**

In `src/app/_layout.tsx`, inside `<Stack>`:

```tsx
      <Stack.Screen name="triage/index" />
```

- [ ] **Step 3: Run every gate**

```bash
npm run check && npm run lint && npm test
```

- [ ] **Step 4: Prove both new modules bundle**

```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
MAP=$(ls /tmp/nenrin-export/_expo/static/js/android/*.hbc.map)
for f in src/domain/triage.ts src/components/triage-card.tsx src/app/triage/index.tsx; do
  printf '%-34s ' "$f"; grep -qa "$f" "$MAP" && echo IN-GRAPH || echo ABSENT
done
```

Expected: all three IN-GRAPH. `src/domain/triage.ts` reaching the bundle is the point — it
was written in Task 2 with nothing importing it, which is exactly the shape that passed the
export gate vacuously twice on the contacts-import branch.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(triage): deal the deck

Re-scans on mount rather than taking four hundred candidates through
router params, which keeps the route deep-linkable and correct after the
app has been backgrounded for a week.

Every action writes immediately. Batching to the end would mean fewer
writes and forty ways to lose forty cards of work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Record what this changed and what it cost

**Files:**
- Modify: `docs/00-design.md` (the v1 scope triage-deck bullet)
- Modify: `AGENTS.md` (new constraint)

- [ ] **Step 1: Correct the design doc**

In `docs/00-design.md`, the triage-deck bullet currently reads:

> **Triage deck** — the core UX bet. A card stack of contacts with no known birthday:
> large name, month+day pickers, big *Skip* and *Don't ask again*. Optimised so a birthday
> you know costs one gesture and two taps. Year is optional throughout.

Replace the last two sentences:

> **Triage deck** — the core UX bet. A card stack of contacts with no known birthday:
> large name, month+day grids, swipe left to skip, swipe right to save, and *Don't ask
> again* as a button because it is the only irreversible action on the card. A birthday you
> know costs two taps and a swipe — the commit is explicit rather than firing on the day
> tap, so nothing saves by surprise and the optional year stays reachable. Year is optional
> throughout.

- [ ] **Step 2: Add the gesture constraint to AGENTS.md**

In the "Non-obvious constraints" list, after the `expo-notifications` entry:

```markdown
- **Gestures need `GestureHandlerRootView` at the app root, or they silently do nothing on
  Android.** It wraps the tree in `src/app/_layout.tsx` and must keep `flex: 1` — without
  the flex the view collapses to zero height and the whole app renders blank. expo-router
  re-exports the component for react-navigation's own stack internals, which is not the same
  as wrapping the root, so its presence in `node_modules` proves nothing. `check`, `lint`,
  `test` and `expo export` all pass with it missing. The Babel half needs no work:
  `babel-preset-expo` ships the Worklets plugin, so `babel.config.js` does not name
  `react-native-worklets/plugin` and must not start.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: record the deck's divergence and the gesture root

00-design.md promised 'one gesture and two taps'. The explicit commit
makes it three, deliberately — nothing saves by surprise and the
optional year stays reachable. Left alone the doc would assert a target
the code knowingly misses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Device verification

Not a task — run this with the user once Task 7 is committed. Nothing below can be checked
without hardware.

1. **Import screen, happy path.** Settings → Import from contacts. Expect `2 contacts
   already have a birthday` and `431 have none`. Tap import; expect `Added 2 contacts.`, and
   the counts to refresh to `0` and `431`.
2. **Month base survives the write.** Open People; the two imported must read 13 April and
   13 June. Any other month means the base broke somewhere between the SDK and the row.
3. **Swipe left.** Card leaves to the left, next card appears, header count increments.
4. **Swipe right with nothing picked.** Card must move a little, stop, spring back, and show
   "Pick a month and a day first." A card that does not move at all is a failure.
5. **Swipe right after picking a month and day.** Person is created; check People.
6. **Don't ask again**, then leave and re-enter triage — that person must not reappear.
7. **Kill the app mid-deck**, reopen, Import → Start. The people you skipped must not be
   dealt again, and the count must reflect that.
8. **Ask me again about the N I skipped.** Deferred people return; refused ones stay buried.
9. **Deny contacts** in Android settings, reopen Import. Expect the "Contacts are off"
   screen, no crash.
10. **Scroll and swipe do not fight.** On a card tall enough to scroll, a vertical drag must
    scroll without throwing the card.
