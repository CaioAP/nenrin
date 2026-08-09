import { describe, expect, it } from 'vitest';

import { resolveLeadDays } from './person';

describe('resolveLeadDays', () => {
  it('falls back to the app default when nothing overrides it', () => {
    expect(resolveLeadDays(null, [], 3)).toBe(3);
  });

  it('prefers the person’s own override over everything else', () => {
    expect(resolveLeadDays(1, [7, 14], 3)).toBe(1);
  });

  it('honours an explicit zero rather than treating it as unset', () => {
    // 0 is "remind me on the day" — a real choice, and the classic falsy-check bug.
    expect(resolveLeadDays(0, [7], 3)).toBe(0);
  });

  it('uses the group lead time when the person has none', () => {
    expect(resolveLeadDays(null, [7], 3)).toBe(7);
  });

  it('takes the longest lead across groups', () => {
    // Someone in both Work (same day) and Close friends (a week ahead) wants the week:
    // reminded too early is an annoyance, too late is the failure the app exists to prevent.
    expect(resolveLeadDays(null, [0, 7, 1], 3)).toBe(7);
  });

  it('ignores groups that set no lead time of their own', () => {
    expect(resolveLeadDays(null, [null, 2, null], 3)).toBe(2);
  });

  it('falls through to the default when every group is unset', () => {
    expect(resolveLeadDays(null, [null, null], 3)).toBe(3);
  });

  it('respects a group that explicitly says "on the day"', () => {
    expect(resolveLeadDays(null, [0], 7)).toBe(0);
  });
});
