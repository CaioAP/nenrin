import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, describeLeadDays, LEAD_DAY_CHOICES } from './settings';

describe('describeLeadDays', () => {
  it('names the same-day case in words rather than "0 days before"', () => {
    expect(describeLeadDays(0)).toBe('On the day');
  });

  it('uses the singular for one day', () => {
    expect(describeLeadDays(1)).toBe('1 day before');
  });

  it('says a week rather than 7 days', () => {
    expect(describeLeadDays(7)).toBe('1 week before');
  });

  it('falls back to a plural count', () => {
    expect(describeLeadDays(3)).toBe('3 days before');
  });

  it('has a label for every offered choice', () => {
    for (const days of LEAD_DAY_CHOICES) {
      expect(describeLeadDays(days)).not.toMatch(/undefined|NaN/);
    }
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('reminds on the day, so a freshly installed app is not silently early', () => {
    expect(DEFAULT_SETTINGS.defaultLeadDays).toBe(0);
  });

  it('fires in the morning', () => {
    expect(DEFAULT_SETTINGS.notifyHour).toBe(9);
    expect(DEFAULT_SETTINGS.notifyMinute).toBe(0);
  });

  it('offers the default lead time as a choice', () => {
    expect(LEAD_DAY_CHOICES).toContain(DEFAULT_SETTINGS.defaultLeadDays);
  });
});
