/**
 * The moment the app last came to the foreground.
 *
 * Two things in this app go stale purely because time passed, with no state change to react
 * to: the Upcoming list (left open across midnight it keeps saying "Tomorrow" for a birthday
 * that is now today) and the armed notification window (it drains as reminders fire). Both
 * want the same trigger, so they share one.
 *
 * A `Date` rather than a counter because the Upcoming list can use it directly as "today" —
 * a bare tick would be a dependency the linter is right to call unused. Callers that need
 * the true current time still read the clock themselves and treat this only as a signal.
 */

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useForegroundTime(): Date {
  const [at, setAt] = useState(() => new Date());

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next) => {
      // Only the transition *into* active counts. On iOS a notification banner or the app
      // switcher pushes the app through 'inactive' and back with no time worth reacting to,
      // and firing on every change would re-arm the whole window each time.
      if (next === 'active' && previous !== 'active') setAt(new Date());
      previous = next;
    });

    return () => subscription.remove();
  }, []);

  return at;
}
