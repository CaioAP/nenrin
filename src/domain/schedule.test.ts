import { describe, expect, it } from 'vitest';

import { makePartialDate } from './birthday';
import { armWindow, DEFAULT_NOTIFICATION_LIMIT, type Reminder, type Schedulable } from './schedule';

const at = (year: number, month: number, day: number, hour = 9, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

const person = (id: string, month: number, day: number, year?: number): Schedulable => ({
  id,
  displayName: id,
  birthday: makePartialDate(month, day, year),
  leadDays: 0,
});

const options = (from: Date, overrides: Partial<Parameters<typeof armWindow>[1]> = {}) => ({
  from,
  timeOfDay: { hour: 9, minute: 0 },
  ...overrides,
});

const idsOf = (reminders: Reminder[]) => reminders.map((r) => r.personId);

describe('armWindow', () => {
  const now = at(2026, 8, 9, 7, 0);

  it('returns nothing for nobody', () => {
    expect(armWindow([], options(now))).toEqual([]);
  });

  it('fires at the configured time of day on the birthday when there is no lead time', () => {
    const [reminder] = armWindow([person('ana', 8, 20)], options(now));
    expect(reminder.fireAt).toEqual(at(2026, 8, 20, 9, 0));
    expect(reminder.occursOn).toEqual(new Date(2026, 7, 20));
    expect(reminder.personId).toBe('ana');
  });

  it('fires early by the lead time', () => {
    const ana = { ...person('ana', 8, 20), leadDays: 7 };
    const [reminder] = armWindow([ana], options(now));
    expect(reminder.fireAt).toEqual(at(2026, 8, 13, 9, 0));
  });

  it('orders by when the notification fires, not by name or birthday', () => {
    const soonWithLongLead = { ...person('december', 12, 1), leadDays: 120 };
    const laterWithNoLead = person('september', 9, 1);
    const reminders = armWindow([laterWithNoLead, soonWithLongLead], options(now));
    expect(idsOf(reminders)).toEqual(['december', 'september']);
  });

  describe('the lead time would already have passed', () => {
    // Birthday in 3 days, but the user asked to be told a week ahead. Skipping the year
    // means missing a birthday that has not happened yet — the worst possible outcome.
    const inThreeDays = { ...person('ana', 8, 12), leadDays: 7 };

    it('still schedules the reminder rather than dropping it to next year', () => {
      const [reminder] = armWindow([inThreeDays], options(now));
      expect(reminder.occursOn.getFullYear()).toBe(2026);
      expect(reminder.occursOn.getMonth()).toBe(7);
    });

    it('fires at the next available time of day instead of in the past', () => {
      // now is 07:00, the daily notification time is 09:00, so today at 09:00 still works.
      const [reminder] = armWindow([inThreeDays], options(now));
      expect(reminder.fireAt).toEqual(at(2026, 8, 9, 9, 0));
      expect(reminder.fireAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it('rolls to tomorrow when today’s notification time has already passed', () => {
      const evening = at(2026, 8, 9, 22, 30);
      const [reminder] = armWindow([inThreeDays], options(evening));
      expect(reminder.fireAt).toEqual(at(2026, 8, 10, 9, 0));
    });

    it('never fires after the birthday itself', () => {
      const tomorrow = { ...person('ana', 8, 10), leadDays: 30 };
      const evening = at(2026, 8, 9, 22, 30);
      const [reminder] = armWindow([tomorrow], options(evening));
      expect(reminder.fireAt).toEqual(at(2026, 8, 10, 9, 0));
      expect(reminder.fireAt.getTime()).toBeLessThanOrEqual(at(2026, 8, 10, 23, 59).getTime());
    });
  });

  describe('the birthday is today and the notification slot has passed', () => {
    // Reachable once a year per person: the window is re-armed on every foreground, so
    // opening the app at 22:30 on someone's birthday re-evaluates a reminder whose 09:00
    // slot is long gone. Scheduling into the past either fires instantly or is dropped by
    // the OS — and today's notification has already been delivered anyway, so a second one
    // would be a duplicate. Drop it and let the Upcoming list carry the day.
    const today = { ...person('ana', 8, 9), leadDays: 0 };
    const evening = at(2026, 8, 9, 22, 30);

    it('does not schedule a reminder in the past', () => {
      expect(armWindow([today], options(evening))).toEqual([]);
    });

    it('drops it regardless of the lead time', () => {
      const longLead = { ...today, leadDays: 30 };
      expect(armWindow([longLead], options(evening))).toEqual([]);
    });

    it('still schedules earlier in the day, before the slot passes', () => {
      const morning = at(2026, 8, 9, 7, 0);
      const [reminder] = armWindow([today], options(morning));
      expect(reminder.fireAt).toEqual(at(2026, 8, 9, 9, 0));
    });

    it('does not let a dropped reminder cost anyone else a slot', () => {
      const [reminder] = armWindow([today, person('bo', 12, 25)], options(evening, { limit: 1 }));
      expect(reminder.personId).toBe('bo');
    });
  });

  describe('the invariant src/notifications depends on', () => {
    it('never returns a fire time at or before now', () => {
      // Anything in the past is either delivered instantly or silently discarded by the OS.
      const crowd = Array.from({ length: 300 }, (_, i) => ({
        ...person(`p${i}`, (i % 12) + 1, (i % 28) + 1),
        leadDays: [0, 1, 7, 30, 120][i % 5],
      }));

      for (const hour of [0, 7, 9, 15, 23]) {
        const from = at(2026, 8, 9, hour, 30);
        for (const reminder of armWindow(crowd, options(from, { limit: crowd.length }))) {
          expect(reminder.fireAt.getTime()).toBeGreaterThan(from.getTime());
        }
      }
    });
  });

  describe('the platform cap on pending notifications', () => {
    // iOS drops everything past a fixed number of pending local notifications, so one
    // notification per person silently breaks as soon as the address book gets real.
    // The window is re-armed on every foreground; it is never the full list.
    const crowd: Schedulable[] = Array.from({ length: 300 }, (_, i) =>
      person(`p${i}`, (i % 12) + 1, (i % 28) + 1),
    );

    it('never arms more than the limit', () => {
      expect(armWindow(crowd, options(now)).length).toBe(DEFAULT_NOTIFICATION_LIMIT);
    });

    it('honours a lower limit', () => {
      expect(armWindow(crowd, options(now, { limit: 10 })).length).toBe(10);
    });

    it('keeps the soonest reminders, not an arbitrary slice', () => {
      const armed = armWindow(crowd, options(now, { limit: 5 }));
      const everything = armWindow(crowd, options(now, { limit: crowd.length }));
      expect(idsOf(armed)).toEqual(idsOf(everything).slice(0, 5));
    });

    it('returns everyone when the crowd is smaller than the limit', () => {
      expect(armWindow(crowd.slice(0, 3), options(now)).length).toBe(3);
    });

    it('emits reminders in ascending fire order', () => {
      const times = armWindow(crowd, options(now)).map((r) => r.fireAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });
  });

  describe('people who should not be reminded about', () => {
    it('skips anyone muted', () => {
      const muted = { ...person('ana', 8, 20), muted: true };
      expect(armWindow([muted, person('bo', 8, 21)], options(now))).toHaveLength(1);
    });

    it('does not let muted people consume slots in the window', () => {
      const muted = Array.from({ length: 50 }, (_, i) => ({
        ...person(`m${i}`, 8, 10),
        muted: true,
      }));
      const real = person('real', 12, 25);
      expect(idsOf(armWindow([...muted, real], options(now, { limit: 5 })))).toEqual(['real']);
    });
  });

  it('carries the age they are turning, for the notification text', () => {
    const [known] = armWindow([person('ana', 8, 20, 1988)], options(now));
    expect(known.turningAge).toBe(38);

    const [unknown] = armWindow([person('bo', 8, 20)], options(now));
    expect(unknown.turningAge).toBeNull();
  });

  it('observes a leap-day birthday on the fallback date', () => {
    const [reminder] = armWindow([person('leap', 2, 29, 2000)], options(at(2027, 1, 1, 7, 0)));
    expect(reminder.occursOn).toEqual(new Date(2027, 1, 28));
  });
});
