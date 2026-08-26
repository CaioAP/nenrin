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
