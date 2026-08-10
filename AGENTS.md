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
  `BirthdaySource` interface. Adding a source is one new file.
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
- **Tests pin `TZ=Europe/London`** (see the npm scripts). The dev machine is in São Paulo,
  which has had no DST since 2019 — run the daylight-saving tests there and they pass
  without ever crossing a transition.
- **Leap-day birthdays are real.** 29 February is storable, and `LeapDayPolicy` decides where
  it lands in a common year. Notifications resolve this themselves — they use one-shot DATE
  triggers on dates the domain already adjusted, so the OS is never asked what 29 February
  means. **Calendar export has the same question still open**: a yearly `RRULE` on 29 February
  may resolve to the 28th, the 1st, or never fire, and only a device can say which. Pin the
  behaviour explicitly when step 8 lands rather than trusting the default.
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

**iOS needs usage-description strings before it can ship.** `expo-contacts`,
`expo-calendar` and `expo-notifications` contribute their Android permissions through
autolinked manifests, so an Android build works with no config plugin entries at all. iOS
has no equivalent — without `NSContactsUsageDescription` and `NSCalendarsUsageDescription`
in `app.json`, the first access call crashes rather than prompting.

## Verifying

`npm run check`, `npm run lint` and `npm test` cover the pure layers. They do **not** prove
the app bundles — imports that only Metro resolves (the `.sql` migrations above) pass all
three and still fail at runtime. Bundle it too:

```bash
npx expo export --platform android --output-dir /tmp/nenrin-export
```

## Commands

```bash
npm start            # expo start
npm run check        # tsc --noEmit
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
npm test             # vitest, TZ-pinned
npm run db:generate  # drizzle-kit generate
```

Biome owns formatting and linting — there is deliberately no ESLint or Prettier, and
`expo lint` is not wired up.
