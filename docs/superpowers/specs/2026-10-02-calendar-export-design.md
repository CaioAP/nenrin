# Calendar export — design

Step 8. Puts every saved birthday into the device calendar as a yearly all-day event, and
keeps it there as people are added, edited and deleted.

## Decisions

Each was chosen over a named alternative, recorded because the reason is not in the code.

### A calendar of Nenrin's own

- **Chosen** — create "Nenrin birthdays" (a local account on Android, the default source on
  iOS) and write only there. Turning export off deletes that one calendar, and a user who
  wants birthdays out of their day view hides one calendar.
- Rejected: **writing into the user's primary calendar.** It syncs to Google and shows on
  every device, which is real value — but removing what Nenrin added becomes a per-event hunt
  through the user's own calendar, and a bug there deletes something that was not ours.

### Kept in sync, not exported once

Like the notification window, the calendar is derived state. Once on, it re-syncs on every
person write, every leap-day policy change and every foreground. A one-shot "export now"
button would be out of date the first time a birthday was edited.

### The database records what was written; the calendar is never asked

Android's event queries hardcode `VISIBLE = 1` (see the visibility trap in the import design).
A user hiding "Nenrin birthdays" would make a sync that reads the calendar see it as empty and
write every birthday a second time. So `exported_event` holds one row per written event with a
fingerprint of what it was written from, and `planExportSync` diffs desired against that.
Rows are written per event, right after the calendar accepts it, so a sync that dies half-way
resumes rather than duplicating.

Changes are delete-and-create, never update: an in-place update of a recurring event is where
the two platforms differ most, and a birthday changes rarely.

### 29 February is one-shot events, not a yearly rule

A yearly `RRULE` on 29 February is skipped in common years under RFC 5545, and `expo-calendar`
cannot express `BYMONTHDAY=-1` on Android. Leap-day birthdays export as eight one-shot events
(two leap years) on dates `occurrenceInYear` resolved under the user's policy; the window
slides forward on each sync. Everyone else gets one yearly event.

### Anchored on the birth year, or on 2000

A yearly event needs a first date. The current year would change every event's fields on
1 January and rewrite the whole calendar annually for nothing. The birth year when known
(the series should not start before the person), otherwise a fixed 2000.

### A deleted calendar means "off"

If the stored calendar is missing — not hidden; `getCalendars` lists hidden ones — the user
deleted it in their calendar app. Export switches itself off rather than recreating it on
the next foreground, which would undo something they did on purpose.

### Export state is not on `settings`

`settings.updatedAt` feeds `Schedulable.knownSince`; bumping it re-sends reminders that
already fired. Export state is a separate single-row `calendar_export` table.

## The write-side midnight fork

`allDayRange(day, encoding)` is the inverse of `partialDateFromAllDayStart`, with the platform
choice made explicit at the adapter boundary: Android writes UTC midnight to the next UTC
midnight with `timeZone: 'UTC'`; iOS writes local midnight, ending where it starts.

## Device checks (no unit test can answer these)

- Samsung: the calendar appears in Samsung Calendar; check whether Google Calendar lists a
  local-account calendar at all.
- A birthday lands on the right day in São Paulo, and the series repeats yearly.
- A 29 February birthday shows on the 28th in 2027 and on the 29th in 2028.
- Edit a birthday → the old event goes, the new one appears. Delete a person → their event goes.
- Hide "Nenrin birthdays" → nothing is written twice. Delete it → export reads as off.
- Turn export on, then import from calendars → none of Nenrin's own events are dealt.
- iOS (no build yet): end-equals-start all-day events, and that deleting a yearly series
  removes every year.
