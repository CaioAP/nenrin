# Nenrin — birthday keeper (v1 design)

*Working name: **Nenrin** (年輪, "annual rings"). Change freely — nothing depends on it.*

## Context

Caio needs a substantial, finishable project for the `projects` section of
[caioalfonso.dev](https://caioalfonso.dev). The idea: an app that stores the birthdays of
everyone you know, reminds you, helps you write the message, and syncs to your calendar.

The open question was social-network vs personal app. Both framings missed the actual
problem, which Caio identified himself:

> "Even if importing the contacts we would need to set the date for each one by hand."

**Data acquisition *is* the product.** Storage + reminders is a solved, crowded category —
every phone already does it badly and nobody cares. The thing worth building is the funnel
that gets 150 birthdays into the app without 150 manual entries.

That reframing also dissolves the social question. The app is personal and self-managed,
but each unknown contact gets an **ask-link**: you send a link over WhatsApp/SMS, the
recipient fills in their own birthday in a web page, it lands in your list. No feed, no
profiles, no account for the responder. You never need to *attract users* — you need
*one-time responders*. That is the social layer, and it's the only one that earns its cost.

The ask-link needs a server, so it is **explicitly out of v1**. v1 proves the local product
and ships; v2 adds the link. Decisions locked with the user: **local-only v1**, **React
Native + Expo**.

## Product thesis

Rank every feature by **cost-per-birthday-acquired**. Build the funnel top-down:

| # | Source | Cost | Stage |
|---|---|---|---|
| 1 | Contacts with a populated `birthday` field | free, one tap | v1 |
| 2 | Device calendar events matching birthday patterns | free, one tap | v1 |
| 3 | Fast manual triage deck (swipe through contacts, day+month only) | ~2s each | v1 |
| 4 | Ask-link — the contact fills it in themselves | ~0, needs server | **v2** |
| 5 | Fully manual add | slow | v1 (escape hatch) |

Facebook birthday export is dead (Graph API removed friend birthdays). Do not plan for it.

## v1 scope

**In**

- Import from device contacts, including the iOS 18 limited-access path.
- Import from device calendars (existing "Birthdays" calendars).
- **Triage deck** — the core UX bet. A card stack of contacts with no known birthday:
  large name, month+day pickers, big *Skip* and *Don't ask again*. Optimised so a birthday
  you know costs one gesture and two taps. Year is optional throughout.
- Local yearly notifications, configurable lead time (same day / 1 day / 1 week before).
- Message generation — a small library of templates with `{name}`, `{age}`, relationship
  tone (family / close friend / colleague), copy-to-clipboard + native share sheet.
- Export to device calendar as yearly recurring all-day events.
- Groups/tags (family, work, school) with per-group notification defaults.
- Upcoming list + full list, search, this-month view.

**Out of v1** (deliberately)

- Accounts, cloud sync, backend of any kind. All arrive in v2 as an **opt-in** account —
  local-only remains a first-class, permanently supported mode, never a trial tier.
- The ask-link (v2 — it is the reason v2 exists).
- Push notifications from a server — local notifications cover every v1 need.
- Gift tracking, contact photos beyond what Contacts gives, analytics.

## Architecture

Local-first, single-process, no network at all in v1. That is a feature: the app works on
a plane, needs no privacy policy beyond "we store nothing," and has zero running cost.

```
app/                      # expo-router file routes
  (tabs)/upcoming | people | settings
  triage/                 # the import triage deck
  person/[id]
src/
  db/                     # expo-sqlite + Drizzle ORM, schema + migrations
  domain/                 # pure TS, zero Expo imports — unit-testable
    birthday.ts           # partial-date type, next-occurrence, age-or-null
    schedule.ts           # which N birthdays to arm next; rolling-window logic
    message.ts            # template rendering
  sources/                # one adapter per acquisition source, same interface
    contacts.ts | calendar.ts | manual.ts
  notifications/          # expo-notifications; arms the window from schedule.ts
  export/                 # expo-calendar writer
```

**Boundary rule that matters:** `src/domain/` imports nothing from Expo or the DB. Dates,
recurrence, and scheduling maths are pure functions over plain objects, tested with Vitest
and no simulator. Everything platform-shaped lives behind an adapter in `sources/`.

**Source adapter interface** — this is what keeps the funnel open/closed, the same way
`_registry.ts` does for the portfolio Playground. Adding the v2 ask-link is one new file
implementing the same interface:

```ts
type ImportCandidate = {
  externalId: string;
  displayName: string;
  birthday: PartialDate | null;   // null → goes to the triage deck
  source: 'contacts' | 'calendar' | 'manual';
};

interface BirthdaySource {
  id: string;
  isAvailable(): Promise<boolean>;
  requestAccess(): Promise<'granted' | 'limited' | 'denied'>;
  fetchCandidates(): Promise<ImportCandidate[]>;
}
```

### Data model (SQLite)

- `person` — id, display_name, birth_day, birth_month, **birth_year nullable**,
  source, external_id, notes, created_at, updated_at, deleted_at.
- `group` / `person_group` — many-to-many.
- `settings` — lead times, quiet hours, notification time-of-day.
- `skipped` — external ids the user chose "don't ask again" for, so triage never
  re-shows them on a later import.

**Partial dates are first-class, not a nullable afterthought.** Most birthdays you know are
day+month only. Every age display, every sort, and every calendar export must handle a
missing year without special-casing at the call site.

**Sync-ready from v1, even though v1 never syncs.** The optional-account backup in v2 is
impossible to bolt on later if v1 gets these wrong, and all three are nearly free now:

- **UUID primary keys, not autoincrement integers.** Two devices must be able to create
  rows offline without colliding.
- **`updated_at` on every row, plus `deleted_at` soft deletes.** A hard delete is invisible
  to a later sync, so a restored backup silently resurrects people the user removed.
- **Every write goes through a repository function in `src/db/`.** No screen touches the
  database directly. v2 then hooks backup into one place instead of thirty.

## Constraints

### Verified against current Expo docs

1. **iOS 18 limited contact access is real.** `Contacts.presentAccessPicker()` returns only
   the contacts the user picks, and `ContactAccessButton` adds them one at a time. Import
   therefore cannot promise "one tap, all your contacts." The UI must handle a partial
   grant as the normal case and offer re-picking later. Design the copy for this up front.
2. **Yearly local notifications are supported natively** —
   `SchedulableTriggerInputTypes.YEARLY` takes month/day/hour/minute. No push server, no
   backend, confirming the local-only v1 is viable.

### Assumed — confirm on device / at review time before relying on them

3. **iOS is believed to cap pending local notifications (commonly cited as 64).** Not
   confirmed in the Expo docs consulted; treat the exact number as unknown. With 200
   contacts, one-notification-per-person silently breaks whatever the cap is, so
   `src/domain/schedule.ts` arms only the next ~40 upcoming birthdays and re-arms on app
   foreground plus a background task. The rolling window is correct regardless of the
   number — **measure the real cap on a device early**, since this is the single most
   likely source of a "notifications stopped working" bug.
4. **Android `READ_CONTACTS` is a Play sensitive permission** requiring a core-functionality
   justification at public-listing review. **Not a v1 concern** — distribution is
   TestFlight + Play internal testing only, which does not go through that review.
   Re-check current Play policy if the app is ever listed publicly. Independently of any
   review risk, make the app fully usable with the permission denied (manual add +
   calendar import); that is good UX on its own.
5. **Contacts birthday fill rate is unknown and user-specific** — a number to measure, not
   a fact. Measure it on real data before assuming import alone carries the product. If it
   lands low, the triage deck (and later the ask-link) is the product, and import is just
   a seeding step.

## Implementation order

1. `src/domain/` — partial dates, next-occurrence, rolling-window scheduling. Pure TS, TDD,
   no simulator needed. Everything else depends on it.
2. `src/db/` — Drizzle schema + migrations, person CRUD.
3. Manual add + people list + upcoming list. **First runnable app.**
4. Notifications, driven by `schedule.ts`. Verify the 64-cap behaviour with a fixture of
   300 people before touching a real device.
5. Contacts source adapter — full grant path, then the limited-access path.
6. The triage deck. Iterate on gesture speed; this is the screen worth polishing.
7. Calendar import adapter.
8. Calendar export.
9. Groups, message templates, settings.

Ship after 9. Do not start v2 before v1 is on a device and used for a real month.

## After v1

### v2 — optional account: automatic backup + ask-link

**The account is opt-in and the app stays fully usable without one.** Two modes, switchable
in both directions, presented as a real choice rather than a nag:

| | Local mode (default, = v1) | Synced mode |
|---|---|---|
| Account | none | email sign-in |
| Network | never | on write |
| Backup | manual export file | automatic, every change |
| Ask-link | unavailable | available |

- **Automatic backup**, not manual "back up now": every write through the `src/db/`
  repository enqueues a change; a background flush pushes it. Offline writes queue and
  drain on reconnect — the app must never block a birthday entry on the network.
- **Ask-link requires an account**, because the responder's answer needs somewhere to land
  while the phone is offline. That is the honest reason to sign up, and the only one worth
  putting in front of the user.
- **Mode transitions both ways.** Signing in must merge existing local data up rather than
  overwrite it or start empty. Signing out keeps every row on the device and stops syncing.
  Sign-in-with-existing-data is the case that breaks in most apps — build it first, not last.
- Stack: Cloudflare Workers + D1 (Caio already runs Cloudflare for the portfolio). Server
  stores birthdays, so v2 is the point where a privacy policy and a deletion path become
  mandatory — not optional politeness.

### v3

Signed local export/import file, so local-mode users have a real backup story without ever
creating an account.

## Distribution and portfolio integration

**Distribution: TestFlight + Play internal testing only.** Real installable builds via EAS
Build for Caio and a handful of testers. No public store listing in v1, so no public review,
no store marketing assets, and no Play sensitive-permission round. Add to step 3 of the
implementation order: get an EAS build onto a real device as soon as the app first runs, so
device-only constraints (notification cap, leap day, limited contact access) surface early
instead of at the end.

**The project card** — separate repository; the portfolio only links to it. When v1 ships,
add one `project` document in Sanity (`studio/schemas/project.ts` — title, role, period,
stack, summary, body, links, cover with required alt, featured, order):

- `links`: GitHub repo, TestFlight public link, Play internal-testing opt-in URL.
  Note both install links expire or need tester allow-listing — the repo and video are the
  durable artifacts, so make the card readable without ever installing.
- Demo video: screen recording of the triage deck. That interaction *is* the argument;
  a static screenshot cannot make it.
- `cover`: needs alt text — the schema enforces it (`validation: (r) => r.required()`).
- `body` (Portable Text): the case-study writeup. Lead with the reframing this whole design
  rests on — *everyone builds storage; the real problem is data entry* — then the funnel
  table, then the constraints that shaped it. This is what makes it read as senior work
  rather than a CRUD demo, and it is the highest-value part of the card.

**Blog carry-over** into `docs/04-showcase-and-blog-backlog.md` Series 3 ("Learning React in
public") — the RN choice was made partly to feed it: partial dates as a domain type, the
pending-notification cap and rolling windows, designing for a permission you might only
partially get, and leap-day recurrence.

## Verification

- `npx vitest` — `src/domain/` covered end to end: leap-day birthdays (Feb 29 in a
  non-leap year), year-boundary next-occurrence, partial dates with no year, and a
  300-person fixture asserting the armed window never exceeds the cap.
- `npx expo start` on a physical device (notifications and Contacts do not work honestly
  in a simulator):
  - Grant contacts fully → import → assert count and that people with a populated
    birthday field skip the triage deck.
  - Grant contacts *limited* on iOS 18 → assert the app still works and offers re-picking.
  - **Deny** contacts → assert manual add and calendar import still fully work.
  - Set a person's birthday to tomorrow, lead time "1 day before", background the app,
    confirm the notification fires.
  - **Leap day on the real platform.** Schedule a `YEARLY` trigger with `month: 1, day: 29`
    and inspect `getNextTriggerDateAsync()` in a non-leap year — does it resolve to Feb 28,
    Mar 1, or never fire? "Never fires" is plausible and would silently drop Feb-29
    birthdays three years in four. The domain unit test cannot answer this; only the device
    can. Whatever it does, pin the behaviour with an explicit fallback in `schedule.ts`.
  - Arm a 300-person fixture on device and count what actually lands, to find the real
    pending-notification cap (constraint 3).
  - Export to calendar → open the system Calendar app → confirm a yearly recurring
    all-day event on the right date, and that a no-year birthday exports correctly.
- `npx tsc --noEmit` and Biome, matching the portfolio's gate discipline.
- Real-data measurement: after the first import, log what fraction of contacts carried a
  usable birthday. That number decides how much v2 matters.

---

*This is the design doc the app was scaffolded from. Where it and the code disagree, the
code is what ships — but the code should not disagree silently. Two deliberate departures so
far: routes live in `src/app/` (Expo template convention) rather than `app/`, and
`armWindow()` drops a reminder outright when the birthday is today and its notification slot
has already passed.*
