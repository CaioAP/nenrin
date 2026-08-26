import { describe, expect, it } from 'vitest';

import type { ImportCandidate } from './import';
import { advance, currentCard, makeDeck, progress, resolveSwipe, SWIPE_THRESHOLD } from './triage';

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

  it('defers left even when the draft is complete, because skipping is not saving', () => {
    // The untested half: a left swipe must ignore canSave entirely. Without this, an
    // implementation that returned 'blocked' for a complete draft would pass every
    // other case in this file.
    expect(resolveSwipe({ translationX: -SWIPE_THRESHOLD - 1, canSave: true })).toBe('defer');
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
