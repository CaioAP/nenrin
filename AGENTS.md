# Nenrin

A birthday keeper. Stores the birthdays of everyone you know, reminds you before the day,
helps you write the message, exports to your calendar. React Native + Expo, local-first.

**Read `docs/00-design.md` before making design decisions.** It records *why* the app is
shaped this way — most of what follows is a consequence of it.

## Expo has changed

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any
Expo code. Do not write Expo APIs from memory.

## The one idea

Storage and reminders are a solved, crowded category. **The product is the data-acquisition
funnel** — getting 150 birthdays in without 150 manual entries. Rank work by
cost-per-birthday-acquired: contacts import, calendar import, the triage deck, then (v2) the
ask-link. Anything that does not reduce entry cost is a side feature.

## Architecture rules

- **`src/domain/` imports nothing from Expo, React Native, or the database.** Dates,
  recurrence, scheduling and message rendering are pure functions over plain objects, tested
  in plain Node. If a change to `src/domain/` needs a simulator to verify, it is in the wrong
  file.
- **Platform access lives behind an adapter** in `src/sources/`, all implementing the same
  `BirthdaySource` interface. Adding a source is one new adapter file; the screens still
  branch per source today — see `src/sources/types.ts`.
- **Every database write goes through a repository function in `src/db/`.** No screen touches
  the database directly — v2 hooks automatic backup into that one place.

## Non-obvious constraints

- **Birthdays usually have no year.** `PartialDate.year` is nullable and age is
  `number | null` everywhere. Never render an age without handling null — `messagesFor()`
  drops age-dependent templates rather than printing "Turning null!".
- **Never schedule one notification per person.** The OS caps pending local notifications
  (iOS commonly cited at 64). `armWindow()` arms only the soonest ~40 and is re-armed on
  every foreground. This fails silently, not loudly — it is the most likely source of a
  "notifications stopped working" report.
- **Every `fireAt` returned by `armWindow()` is strictly later than `from`.** Scheduling into
  the past either fires instantly or is dropped by the OS.
- **All date arithmetic is local-calendar arithmetic.** A birthday is a calendar day, not an
  instant. Nothing in `src/domain/` touches UTC.
- **Tests run under two pinned time zones, and they check different things.** `npm test` pins
  `TZ=Europe/London`, which is the one that crosses a DST transition — the dev machine is in
  São Paulo, which has had no DST since 2019, so the daylight-saving tests would pass there
  without ever crossing one. `npm run test:tz` pins `TZ=America/Sao_Paulo`, a fixed UTC−3, to
  catch anything that decodes a calendar-sourced date through UTC instead of the local
  calendar — that bug is invisible in London, whose offset was 0 or +1 for most of the test
  suite's dates. Both must report the same test count; a change that only shows up in one
  zone is not verified until it has run in both.
- **Leap-day birthdays are real.** 29 February is storable, and `LeapDayPolicy` decides where
  it lands in a common year. Notifications resolve this themselves — they use one-shot DATE
  triggers on dates the domain already adjusted, so the OS is never asked what 29 February
  means. **Calendar export avoids the question the same way**: a yearly `RRULE` on 29 February
  is skipped in common years under RFC 5545, and `expo-calendar`'s Android recurrence carries
  only frequency, interval, count and end date, so `BYMONTHDAY=-1` is iOS-only. Leap-day
  birthdays therefore export as one-shot events over a sliding eight-year horizon, on dates
  `occurrenceInYear` already resolved under the user's policy; everyone else gets one yearly
  event. See `src/domain/calendar-export.ts`.
- **Notifications use DATE triggers, never YEARLY, and only cover a horizon.** A recurring
  trigger cannot express what `armWindow` produces — lead time moves a reminder off the
  birthday, a long lead clamps to the next slot, and a reminder with no useful moment left is
  dropped. So the app arms concrete dates and re-arms them on every foreground and every
  write. The cost: nothing re-arms while the app is closed, so a user who never opens Nenrin
  eventually drains the window. Closing that gap needs a background task, which is knowingly
  **not in v1** — it would add a dependency, a config plugin, and a second device-only
  verification loop.
- **`Schedulable.knownSince` is what stops a reminder repeating every day.** Re-arming means
  `armWindow` re-evaluates reminders whose moment has already gone. Catching those up is
  right for a person just added, and wrong for one whose reminder already fired — and the
  two are indistinguishable without it, because a local notification delivered while the app
  was closed leaves no trace the app can read. So the catch-up branch runs only when the
  schedule changed *after* the moment passed. Without the guard, a one-week lead time sends
  eight notifications instead of one. Accepted gap: granting notification permission long
  after adding people catches up nobody, since their `updatedAt` predates the missed slots.
- **Contacts access can be partial.** iOS 18 limited access means the user picks individual
  contacts, so import can never promise "one tap, all your contacts". The app must also be
  fully usable with contacts permission *denied*.
- **Never `import` `expo-notifications` at module scope.** Use `loadNotifications()` in
  `src/notifications/reminders.ts`, which dynamic-imports it behind an `isRunningInExpoGo()`
  check. A plain import **crashes the entire app in Expo Go on Android at launch**, and not
  because of anything you called: the barrel re-exports
  `DevicePushTokenAutoRegistration.fx`, which registers a push-token listener at module
  scope, and that listener throws because remote push was removed from Expo Go in SDK 53.
  The symptom does not name notifications — every route below the import fails to evaluate
  and you get `Route "./_layout.tsx" is missing the required default export` followed by
  `Cannot read property 'ErrorBoundary' of undefined`. `check`, `lint`, `test` and
  `expo export` all pass with this bug present.
- **Gestures need `GestureHandlerRootView` at the app root, or they silently do nothing on
  Android.** It wraps the tree in `src/app/_layout.tsx` and must keep `flex: 1` — without
  the flex the view collapses to zero height and the whole app renders blank. expo-router
  re-exports the component for react-navigation's own stack internals, which is not the same
  as wrapping the root, so its presence in `node_modules` proves nothing. `check`, `lint`,
  `test` and `expo export` all pass with it missing. The Babel half needs no work:
  `babel-preset-expo` ships the Worklets plugin, so `babel.config.js` does not name
  `react-native-worklets/plugin` and must not start.
- **Android rejects `ContactField.BIRTHDAY`, and takes the whole call down with it.**
  `expo-contacts` declares one `ContactField` enum for both platforms, but the Android native
  enum (`android/.../records/fields/ContactField.kt`) omits exactly two members: `BIRTHDAY`
  and `NON_GREGORIAN_BIRTHDAY`. Requesting one does not come back empty — argument conversion
  fails and `Contact.getAllDetails` rejects the entire query with `Couldn't convert 'birthday'
  to ContactField`, so zero contacts are read. **The field list is itself a platform fork**,
  separate from the fork over where a birthday then turns up (`birthday` on iOS, a `dates`
  entry labelled `"birthday"` on Android — a fixed English literal from `EventLabelMapper`,
  not the device locale). The four fields that file marks "iOS only" are present in the enum
  and convert fine; they just return nothing. Nothing in the TypeScript types says any of
  this: `check`, `lint` and `expo export` all pass, and the failure is a runtime rejection on
  a device.

- **On Android, `expo-calendar` cannot read a calendar the user has unticked, and reports it
  as empty.** Both APIs hardcode the same clause — `InstanceRepository.buildSelection` in the
  next API and `buildSelectionForEventsQuery` in the legacy one both add
  `CalendarContract.Instances.VISIBLE = 1` to the selection, with no option to omit it.
  `VISIBLE` is the *calendar's* checkbox in the user's calendar app, not a property of any
  event. So a hidden calendar returns zero events, which is indistinguishable from a calendar
  that has none — and hiding the birthday calendar is exactly what a user does when it
  clutters their day view. Nothing in the TypeScript types, the docs, or the `Calendar`
  object says this; `isVisible` is documented only as "indicates whether the OS displays
  events on this calendar", which reads as a display hint rather than a query filter. **This
  already produced two wrong conclusions in a row**: a device probe reported 0 birthday events
  across 573 while the primary Google calendar sat `isVisible: false`. Made visible, the same
  phone returned ten real birthdays that had been there all along. Always print `isVisible`
  beside an event count from this module, and never read a zero without it.

  **`VISIBLE` belongs to whichever app manages calendars, and that is not necessarily the app
  the user thinks.** On the Samsung test device the calendars read as ticked inside Google
  Calendar while the provider had them hidden — Samsung Calendar owns the column there, and
  Google Calendar keeps its checkboxes to itself. So a user can have a calendar switched on,
  see its events every day, and have it be unreadable to this app. The import UI must say how
  many calendars are hidden rather than reporting "no birthdays found", because the two are
  indistinguishable from inside the API. `isVisible` is also **read-only from JavaScript**:
  the Kotlin `CalendarUpdateRecord` accepts it, but `ModifiableCalendarProperties` is
  `Pick<ExpoCalendar, 'color' | 'title'>`, so the app cannot fix this for the user.

- **`expo-calendar` cannot run in Expo Go, and names a calendar differently on each
  platform.** The module resolves `CalendarNext` at import and substitutes
  `ExpoGoCalendarNextStub` under Expo Go — every method of it throws, so unlike
  `expo-notifications` the *import* is safe and only the calls die. A dev build is required
  either way. The fork that shapes the adapter is **which field identifies a calendar**:
  `type === 'birthdays'` (`SourceType.BIRTHDAYS`) is **iOS only** and simply absent on
  Android, which instead carries `name`, `ownerAccount`, `isPrimary` and
  `source.{name,type}`. Matching the display `title` is wrong on both — that string is the
  user's locale, not a key. Event ids fork too: `instanceId` is Android-only and documented
  as "volatile ... not guaranteed to always refer to the same instance", while
  `originalStartDate` is iOS-only. `externalId` is the whole de-duplication contract
  (`partitionCandidates`, `person_external_idx`), so an id that changes between reads would
  re-deal the same person on every scan, silently.

  **Measured on a Samsung device, 2026-08-26** — `type` was `null` on all sixteen calendars,
  confirming it is genuinely iOS-only rather than merely undocumented. The generated birthday
  calendar there is `ownerAccount="local.samsungbirthday"`, and its `name` is `"Birthday"`
  while its `title` is `"Contacts' important dates"` — one calendar, two different strings,
  neither of them the other platform's. Event ids survived a 180-day window shift, so an
  `id` **can** be an `externalId`; note it is the master row, repeating across occurrences,
  while `instanceId` differs per occurrence. And `listEvents` returns expanded instances that
  carry a populated `recurrenceRule` *and* the occurrence's own `startDate`, so that year is
  the occurrence's, never the birth year — this source could not fill `PartialDate.year` on
  Android even if it had data — confirmed on a device, where every birthday event's
  `startDate` was the expanded occurrence (2027) beside a populated
  `{"frequency":"yearly"}` rule. Birthday events also do **not** live in a birthdays calendar:
  they sit in the user's primary calendar, and the "Birthdays" heading in the Google Calendar
  app corresponds to nothing in `CalendarContract`. Matching on calendar identity finds none
  of them; the name has to be parsed out of the title, which is written in the *Google
  account's* language rather than the device locale (`"Mãe's birthday"` on a Portuguese
  phone). See *What the free sources actually yielded* in `docs/00-design.md`.

- **All-day events are encoded in UTC on both platforms, but only one of them starts at UTC
  midnight.** `partialDateFromAllDayStart` (`src/domain/calendar-date.ts`) decodes with UTC
  getters, which is correct for Android — its all-day events genuinely are stored as UTC
  midnight. iOS is the opposite: `expo-calendar`'s `ios/Conversions/Conversions.swift`
  defines a module-wide `dateFormatter` pinned to `TimeZone(identifier: "UTC")`, and
  `ios/Next/CalendarNextModule.swift`'s `Property("startDate")` renders `EKEvent.startDate`
  through that formatter — but `EKEvent.startDate` is an absolute instant, and EventKit
  begins an all-day event at *local* midnight, not UTC midnight. So on a device in UTC+9, a
  25 January birthday's local midnight is `2027-01-24T15:00:00Z`, and formatting that instant
  in UTC yields the 24th, not the 25th. The two bugs are mirror images: Android's UTC-midnight
  encoding breaks under local getters for every user *west* of Greenwich (a negative offset
  reads back a day early — the São Paulo case this file's doc comment already walks through),
  while iOS's local-midnight-in-UTC encoding breaks under UTC getters for every user *east*
  of Greenwich (any positive offset subtracts hours from local midnight and rolls back a
  calendar day in UTC). A negative offset — São Paulo's UTC−3 among them — happens to decode
  correctly on iOS today; a positive one, UTC+9 above, does not.
  `partialDateFromAllDayStart` is Android-correct and iOS-wrong today. There is no iOS build
  yet to confirm this against a device, only against the two Swift files above. Fixing it is
  not a matter of swapping UTC getters for local ones — `src/domain/` must stay platform-free,
  so the domain function needs an explicit "which midnight" argument, decided by
  `Platform.OS` at the adapter boundary in `src/sources/calendar.ts`, not inside the domain
  function itself.

- **Calendar export writes into a calendar Nenrin creates, and never asks the calendar what it
  holds.** Every event query on Android carries the `VISIBLE = 1` clause above, so a user who
  hid "Nenrin birthdays" would make it read as empty and get every birthday written again on
  the next sync. The `exported_event` table is the record instead, written one row per event
  straight after the calendar accepts it, and `planExportSync` diffs against it by
  fingerprint. `getCalendars` has no such filter, which is what lets a sync tell a hidden
  calendar (keep writing) from a deleted one (the user switched export off — do not recreate
  it). The write side has the same midnight fork as the read side, met explicitly:
  `allDayRange` takes an `AllDayEncoding` chosen from `Platform.OS` in `src/export/calendar.ts`
  — Android needs UTC midnight *and* `timeZone: 'UTC'`, or `expo-calendar` stamps the device
  zone on the row. Two more traps there: `ExpoCalendarEvent.get` returns the first occurrence
  with an iOS span of `.thisEvent`, so deleting a yearly series needs
  `getOccurrenceSync({ futureEvents: true })` first or only one year goes; and export state
  lives in its own `calendar_export` table rather than on `settings`, because bumping
  `settings.updatedAt` moves every person's `knownSince` and re-sends reminders that already
  fired. The calendar importer skips the export calendar (`isExportCalendar`), by `name` on
  Android and by title on iOS.

- **`expo-contacts` disagrees with its own types in two places, and both typecheck.**
  `ContactsPermissionResponse.accessPrivileges` is declared optional and is `undefined` on
  Android and pre-iOS-18 — it is an iOS 18 concept and appears nowhere in the Android native
  source. Returning it raw from anything typed `AccessLevel` hands back `undefined`; `tsc`
  accepts it and every caller's `switch` falls through. Map it: `accessPrivileges ?? (granted
  ? 'all' : 'none')`. Separately, `ContactDate.year` is typed `year?: number`, but a device
  really sends `{"day":13,"month":4,"year":null}` — so any type derived from `ContactDate`
  will reject a fixture built from what the platform actually returns. `makePartialDate`
  takes `year?: number | null` for this reason; do not narrow it. `month` **is** 1–12 as
  documented, confirmed against contacts entered as 13 April and 13 June.

- **Migrations need `metro.config.js` *and* `babel.config.js`, both.** `./drizzle/migrations.js`
  imports each migration as a `.sql` file. Metro must resolve the extension
  (`sourceExts.push('sql')`) *and* `babel-plugin-inline-import` must inline it as a string —
  with only the first, Babel receives the file as source and dies on
  `SyntaxError: Missing semicolon` at `CREATE TABLE`. Neither file is in the Expo template.
- **After changing `src/db/schema.ts`, run `npm run db:generate`.** The app applies the
  generated bundle, not the schema file, so a schema change alone does nothing at runtime.

## Web is not a supported target

`npm run web` does not work, and making it work is not a small config change. Investigated
and abandoned deliberately — three separate blockers, in the order you hit them:

1. `expo-sqlite`'s web build imports its own `wa-sqlite.wasm`, but SDK 57's default Metro
   config lists `wasm` in neither `assetExts` nor `sourceExts`. Fixable with
   `config.resolver.assetExts.push('wasm')`.
2. wa-sqlite then needs `SharedArrayBuffer`, so the page must be cross-origin isolated.
   Fixable by sending `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` from the dev server.
3. **The blocker.** `openDatabaseSync` runs at module scope in `src/db/client.ts`. On web
   that blocks the main thread waiting on a worker that cannot reply, because the main
   thread is blocked — `Error: Sync operation timeout`. Fixing it means making the database
   handle async and restructuring every consumer.

(3) is a real change to core code in exchange for a platform the product does not ship to,
so the app stays native-only. Do not add the two Metro workarounds on their own: they get
further without ever reaching a working app.

Use Expo Go or a dev build instead.

## Builds

`eas.json` pins `"node": "24.14.0"` on a `base` profile that every other profile extends.
This is not cosmetic. EAS runs `nvm install <version>` on its own cloud worker, which never
sees the local Node — and the worker's default is old enough to ship npm 10, which rejects
this lockfile with `EBADPLATFORM @esbuild/aix-ppc64`. npm 11 accepts it. The same mismatch
already broke GitHub Actions, which is why CI is pinned to Node 24 and `engines.node` is
`>= 24`. Do not drop the pin from a new profile.

**iOS limited access may read as denial, depending on the Swift toolchain.** `expo-contacts`'
`ContactsRequester.swift` maps `.limited` to a *granted* status carrying `scope: "limited"`,
which is what makes `requestAccess()` safe to short-circuit on `!granted` before reading
`accessPrivileges`. But that mapping sits behind `#if compiler(>=6)`. Built with an older
Swift compiler, `.limited` falls through to `@unknown default` and reports undetermined — so
a user who granted access to a hand-picked subset looks exactly like a user who refused.
No iOS build exists yet to say which branch a real build takes. Check this before trusting
limited access on iOS 18+; it is a property of how the pod was compiled, not of app code.

**Config plugins arrive on their own; an `app.json` entry only passes them props.** Expo
auto-applies the config plugin of every autolinked module, so `expo-contacts`,
`expo-calendar` and `expo-notifications` put their Android permissions *and* their iOS
usage-description strings into the merged manifest and `Info.plist` with no `plugins` entry
at all — carrying the plugin's own generic English default copy. (Only `expo-notifications`
declares permissions in its own `AndroidManifest.xml`; the other two get theirs from their
plugin, which is why reading a module's manifest is not how you answer this.)

So `expo-calendar` is listed for exactly two reasons, neither of them the permission:
`calendarPermission` replaces "Allow nenrin to access your calendars" with copy that says
why, and `remindersPermission: false` **deletes** `NSRemindersUsageDescription` and
`NSRemindersFullAccessUsageDescription`. Nenrin never touches reminders, and shipping those
strings would ask App Review to approve access the app does not use.

Check what actually lands rather than reasoning about it from plugin source — this prints
the merged result:

```bash
npx expo config --type introspect | grep -E "permissions:|UsageDescription" -A10
```

`withCalendar` adds `READ_CALENDAR` **and** `WRITE_CALENDAR` together, with no prop to omit
either half. Calendar export uses the write half; the usage string says so.

## Verifying

`npm run check`, `npm run lint`, `npm test` and `npm run test:tz` cover the pure layers.
Run both test scripts, not just one: `npm test` pins `TZ=Europe/London` for the
daylight-saving tests, `npm run test:tz` pins `TZ=America/Sao_Paulo` for anything that
decodes a calendar-sourced date through UTC — each catches what the other zone cannot, and
both must report the same count. None of the four prove the app bundles — imports that only
Metro resolves (the `.sql` migrations above) pass all four and still fail at runtime. Bundle
it too:

```bash
npx expo export --platform android --output-dir /tmp/nenrin-export
```

**And know what that gate does not cover: `expo export` bundles only what is reachable from
`src/app/`'s entry graph.** A module nothing imports yet is never resolved, so its export
passes vacuously — green, and evidence of nothing. This bit twice in one branch: `src/sources/
contacts.ts` and `src/db/skipped.ts` both passed the gate while no route reached either.
Before treating a green export as proof a new file bundles, confirm something under
`src/app/` actually imports it, transitively. Export with `--dump-sourcemap` and grep the
`.hbc.map` for the module path — its `sources` list is the module graph itself, so a hit is
proof and a miss is proof of absence:

```bash
npx expo export --platform android --dump-sourcemap --output-dir /tmp/nenrin-export
grep -c 'src/sources/contacts.ts' /tmp/nenrin-export/_expo/static/js/android/*.hbc.map
```

Do not grep the `.hbc` itself for an identifier. Minification renames functions, so
`scanContacts` and `DebugPanel` are both absent from a bundle that plainly contains them —
only string literals and the sourcemap survive intact.

**The sourcemap check does not work for route files.** expo-router globs everything under
`src/app/` into its route table, so a route appears in the module graph whether or not any
screen links to it — the same vacuous pass the check exists to catch, in a new place. For a
file under `src/app/`, the evidence is instead the caller's diff (something must `router.push`
or `Link` to it) plus the typed-route union `tsc` generates, which only contains routes that
really exist. Reserve the sourcemap grep for modules outside `src/app/`, which is where it
was derived and where it holds.

**Nor does it work for anything reachable only under `__DEV__`.** `expo export` builds
production, where `__DEV__` is `false`, `DebugTools` folds to `null` and the whole panel is
eliminated — its string literals included, and with them any module it alone pulled in. A
dynamic `import('expo-calendar')` inside a probe is absent from the production sourcemap for
that reason, and so is `probeContacts`, which has run on a device. **The absence is the
correct result** — debug code must not ship — so it is evidence of nothing either way. Ask
Metro for the bundle the device will actually run instead:

```bash
npx expo start --port 8099 &
curl -s 'http://127.0.0.1:8099/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false' -o /tmp/dev.bundle
grep -c -a -F 'expo-calendar/src/Calendar.ts' /tmp/dev.bundle
```

`dev=true` keeps `__DEV__` live and `minify=false` keeps the strings, so grepping for a
module path *or* a literal both work — this is the one bundle where an identifier survives.
Note the entry point is `.expo/.virtual-metro-entry.bundle`: `index.bundle` does not exist
here, because `package.json` names `expo-router/entry` as `main`. (`expo export --dev`
segfaults on this machine; it is not the way in.)

## Commands

```bash
npm start            # expo start
npm run check        # tsc --noEmit
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
npm test             # vitest, TZ=Europe/London (DST transitions)
npm run test:tz      # vitest, TZ=America/Sao_Paulo (UTC-decoded calendar dates)
npm run db:generate  # drizzle-kit generate
```

Biome owns formatting and linting — there is deliberately no ESLint or Prettier, and
`expo lint` is not wired up.
