import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  describeLeadDays,
  describeLeapDayPolicy,
  formatTimeOfDay,
  LEAD_DAY_CHOICES,
  NOTIFY_TIME_CHOICES,
} from './settings';

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

  it('offers the default notify hour as a choice', () => {
    // Otherwise the settings screen opens with nothing selected on a fresh install, which
    // reads as "unset" for a setting that is very much set.
    expect(NOTIFY_TIME_CHOICES).toContain(DEFAULT_SETTINGS.notifyHour);
  });
});

describe('formatTimeOfDay', () => {
  it('pads both halves to two digits', () => {
    expect(formatTimeOfDay(7, 0)).toBe('07:00');
  });

  it('leaves an already two-digit hour alone', () => {
    expect(formatTimeOfDay(20, 30)).toBe('20:30');
  });

  it('renders midnight rather than an empty hour', () => {
    expect(formatTimeOfDay(0, 0)).toBe('00:00');
  });
});

describe('describeLeapDayPolicy', () => {
  it('says the date a 29 February birthday lands on, not the token', () => {
    expect(describeLeapDayPolicy('feb28')).toBe('28 February');
    expect(describeLeapDayPolicy('mar1')).toBe('1 March');
  });
});
