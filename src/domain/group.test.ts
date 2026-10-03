import { describe, expect, it } from 'vitest';

import {
  type Group,
  groupsOf,
  leadChanges,
  MAX_GROUP_NAME_LENGTH,
  parseGroupName,
  resolveTone,
  suggestedGroupNames,
} from './group';

describe('parseGroupName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(parseGroupName('  Close   friends ', [])).toEqual({ ok: true, value: 'Close friends' });
  });

  it('refuses a blank name', () => {
    expect(parseGroupName('   ', [])).toEqual({ ok: false, error: 'A group needs a name.' });
  });

  it('refuses a name too long for a chip', () => {
    expect(parseGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH + 1), []).ok).toBe(false);
    expect(parseGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH), []).ok).toBe(true);
  });

  it('treats a different case or spacing as the same group', () => {
    expect(parseGroupName('work ', ['Work'])).toEqual({
      ok: false,
      error: 'There is already a group called Work.',
    });
    expect(parseGroupName('close friends', ['Close  friends']).ok).toBe(false);
  });

  it('lets a group keep its own name, or fix its capitalisation', () => {
    expect(parseGroupName('Work', ['Work', 'Family'], 'Work')).toEqual({ ok: true, value: 'Work' });
    expect(parseGroupName('WORK', ['Work', 'Family'], 'Work')).toEqual({ ok: true, value: 'WORK' });
  });

  it('still refuses a rename onto another group', () => {
    expect(parseGroupName('family', ['Work', 'Family'], 'Work').ok).toBe(false);
  });
});

describe('suggestedGroupNames', () => {
  it('offers all three on a fresh install', () => {
    expect(suggestedGroupNames([])).toEqual(['Family', 'Work', 'School']);
  });

  it('drops the ones that already exist, whatever their case', () => {
    expect(suggestedGroupNames(['family', 'Book club'])).toEqual(['Work', 'School']);
  });
});

describe('resolveTone', () => {
  it('prefers the person’s own choice', () => {
    expect(resolveTone('colleague', ['family'])).toBe('colleague');
  });

  it('uses the group tone when the person never chose one', () => {
    expect(resolveTone(null, ['family'])).toBe('family');
  });

  it('uses it when every group with a tone agrees', () => {
    expect(resolveTone(null, ['family', null, 'family'])).toBe('family');
  });

  it('decides nothing when groups disagree', () => {
    expect(resolveTone(null, ['family', 'colleague'])).toBeNull();
  });

  it('decides nothing with no groups, or none that set a tone', () => {
    expect(resolveTone(null, [])).toBeNull();
    expect(resolveTone(null, [null])).toBeNull();
  });
});

describe('leadChanges', () => {
  it('is true when joining a group moves the lead time', () => {
    expect(leadChanges(null, [], [7], 0)).toBe(true);
  });

  it('is false when the group has no lead time of its own', () => {
    expect(leadChanges(null, [], [null], 0)).toBe(false);
  });

  it('is false when a longer lead already wins', () => {
    expect(leadChanges(null, [7], [7, 1], 0)).toBe(false);
  });

  it('is false when the group lead equals what the default already gave', () => {
    expect(leadChanges(null, [], [3], 3)).toBe(false);
  });

  it('is false for a person with an override of their own', () => {
    expect(leadChanges(1, [], [7], 0)).toBe(false);
  });

  it('is true when leaving the group that set the lead', () => {
    expect(leadChanges(null, [7], [], 0)).toBe(true);
  });
});

describe('groupsOf', () => {
  const group = (id: string, members: string[]): Group => ({
    id,
    name: id,
    leadDays: null,
    tone: null,
    memberIds: new Set(members),
  });

  it('returns the groups that contain the person, in order', () => {
    const groups = [group('a', ['p1']), group('b', ['p2']), group('c', ['p1', 'p2'])];
    expect(groupsOf('p1', groups).map((g) => g.id)).toEqual(['a', 'c']);
  });
});
