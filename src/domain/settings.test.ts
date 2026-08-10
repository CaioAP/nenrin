import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  describeLeadDays,
  describeLeapDayPolicy,
  formatTimeOfDay,
  isPresetTime,
  LEAD_DAY_CHOICES,
  NOTIFY_TIME_CHOICES,
  parseTimeOfDay,
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

describe('isPresetTime', () => {
  it('recognises an offered shortcut', () => {
    expect(isPresetTime(9, 0)).toBe(true);
  });

  it('rejects an offered hour with minutes on it', () => {
    // 09:30 is not the 09:00 chip, and showing that chip as selected would misreport the
    // setting the user actually saved.
    expect(isPresetTime(9, 30)).toBe(false);
  });

  it('rejects an hour that is not offered', () => {
    expect(isPresetTime(3, 0)).toBe(false);
  });
});

describe('parseTimeOfDay', () => {
  const parse = (hour: string, minute: string) => parseTimeOfDay({ hour, minute });

  it('accepts a valid time', () => {
    expect(parse('6', '45')).toEqual({ ok: true, value: { hour: 6, minute: 45 } });
  });

  it('accepts midnight', () => {
    expect(parse('0', '0')).toEqual({ ok: true, value: { hour: 0, minute: 0 } });
  });

  it('accepts the last minute of the day', () => {
    expect(parse('23', '59')).toEqual({ ok: true, value: { hour: 23, minute: 59 } });
  });

  it('ignores surrounding whitespace', () => {
    expect(parse(' 7 ', ' 05 ')).toEqual({ ok: true, value: { hour: 7, minute: 5 } });
  });

  it('rejects an hour past the end of the day', () => {
    const result = parse('24', '0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.hour).toBeDefined();
  });

  it('rejects sixty minutes', () => {
    const result = parse('9', '60');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.minute).toBeDefined();
  });

  it('rejects a negative hour', () => {
    expect(parse('-1', '0').ok).toBe(false);
  });

  it('rejects a fractional minute rather than rounding it', () => {
    expect(parse('9', '30.5').ok).toBe(false);
  });

  it('rejects a blank field instead of reading it as zero', () => {
    // Number('') is 0, so a blank minute would silently become :00 without the empty check.
    const result = parse('9', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.minute).toBeDefined();
  });

  it('reports both fields at once', () => {
    const result = parse('99', '99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.hour).toBeDefined();
      expect(result.errors.minute).toBeDefined();
    }
  });

  it('accepts every preset hour it offers', () => {
    for (const hour of NOTIFY_TIME_CHOICES) {
      expect(parse(String(hour), '0').ok).toBe(true);
    }
  });
});
