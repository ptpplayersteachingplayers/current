# PTP Supabase — Phases 1 and 2

The foundation and the group engine for the year-round training operation:
schema, migrations, RLS, database functions, seed data, and the edge functions
that sit on top of them.

**Nothing here is deployed.** The WordPress private-training system stays live
and untouched until this is proven.

## Verify it

```bash
./test.sh                         # everything
./verify.sh                       # builds a throwaway DB and asserts the rules
PGHOST=/var/run/postgresql ./verify.sh
```

71 assertions against a real PostgreSQL 16 — the seeded state, the guards,
capacity, the block rule, trainer pay, the checkout path, credits, drop-ins,
the waitlist, authorisation, the scheduled jobs and webhook retries — plus 12
against the Stripe signature verifier, run under Node with the actual source
the edge function uses.

Three bugs of my own that these found, for the record: `cancel_booking()` had
never been executed and did not compile past its first statement; the message
de-duplication in `queue_outbound_message()` silently raised instead of
de-duplicating, because `on conflict` cannot infer a partial index without
repeating its predicate; and a drop-in booking enrolled the player for the
whole season, so four families dropping in on one Thursday would have committed
a trainer to sixteen sessions.

## See it happen

```bash
./trace-booking.sh
```

One family's purchase run against a real database, printing what changed after
each step: the price the server decided, the hold, the double tap that makes
one checkout, the webhook, the sixteen credits, the group flipping to
confirmed, the replayed event that changes nothing, and another parent being
refused. `docs/BOOKING-A-PACKAGE.md` is its output.

## Layout

```
migrations/
  0001_foundation.sql          extensions, enums, settings, audit, webhook idempotency
  0002_people.sql              households, contacts, players, trainers, availability
  0003_places_seasons_groups.sql  locations, field verification, seasons, groups, sessions
  0004_commerce.sql            payments, packages, credits, holds, bookings, enrollments
  0005_group_engine.sql        eligibility, capacity, activation, holds, waitlists
  0006_blocks.sql              trainer shifts, private slots, the back-to-back rule
  0007_rls.sql                 row level security
  0008_messaging.sql           conversations, messages, escalations
  0011_checkout.sql            checkout intents, settlement, refunds, waitlist conversion, attendance
  0012_jobs.sql                reminders, promotions, the tier dispatcher
docs/
  PHASE-0-AUDIT.md             what is in the old system and what happens to it
  BOOKING-A-PACKAGE.md         a real purchase, traced through the database
functions/
  _shared/                     clients, HTTP, Stripe, signature verification
  catalog checkout stripe-webhook book-with-credit
  cancel-booking waitlist attendance jobs
  tests/signature.test.mjs
seed/
  0009_settings.sql            every operational number
  0010_demo_season.sql         one season, six groups, three trainers, six families
```

## The rules, and where they live

| Rule | Enforced by |
|---|---|
| 4 paid activates, 6 is full | `recompute_group_status()` — the only writer of group status |
| A hold occupies a place for 15 minutes | `create_booking_hold()`, released by `expire_booking_holds()` |
| Age and skill gate a group | `player_is_eligible()`, checked inside the hold |
| No group opens on an unverified field | `training_groups_guard_activation` trigger |
| No trainer travels for one isolated hour | `slot_adjoins_work()` + `evaluate_trainer_block()` |
| A confirmed block survives a cancellation | `handle_block_cancellation()` |
| A trainer cannot be in two places | exclusion constraint on `sessions` |
| A webhook processes once | unique `(source, external_id)` + `claim_webhook_event()` |
| One family cannot see another | RLS, `current_household_id()` |
| A trainer cannot set their own pay | `trainers_protect_privileged_columns` trigger |
| The client never sends a price | `begin_checkout()` reads it from `system_settings` |
| Money becomes a place exactly once | `claim_webhook_event()` → `settle_checkout()`, both idempotent |
| A drop-in is not a season | `confirm_booking(..., p_enroll)`, false unless a package asked |
| A place on the field is counted separately from a place in the group | `session_occupancy()` and `group_occupancy()` |
| A parent cannot act on another family's child | `assert_player_access()`, called inside every definer function a client can reach |
| A waitlist place converts only when paid | `accept_waitlist_invite()` returns a checkout, not a place |
| One reminder, once | unique partial index on `messages.dedupe_key` |
| Everything stops at once | `automation_paused()`, checked by `run_scheduled_job()` and `queue_outbound_message()` |

## Two conventions

**Money is integer cents.** Never numeric, never float. Rounding is decided
explicitly in one place.

**Duplicate protection is a constraint, not a check.** An application check has
a race between the read and the write; payment webhooks retry into that race.

**RLS protects tables, not functions.** A `SECURITY DEFINER` function runs as
its owner and sees everything, and these functions take ids as arguments — so
each one that a browser can reach calls `assert_player_access()` or
`assert_household_access()` in its own body. This was the largest defect class
in the old platform and it does not become safe by moving to a new database.

## Local Postgres, for reference

```bash
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /tmp/pgtest/data -U postgres --auth=trust
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest/data \
  -o '-k /tmp/pgtest/sock -p 5433 -c listen_addresses=' -l /tmp/pgtest/log start
```

`auth.uid()` and `auth.jwt()` are stubbed by `verify.sh`; Supabase provides
them in production.

## Not built yet

Phase 3 is the parent and trainer interfaces. Phase 4 is Quo, HubSpot, the
WordPress API bridge and the AI follow-up agent — `conversations`, `messages`
and `escalate()` are in place for it, and `queue_outbound_message()` is the
only way anything may send.

Not verified, and honestly: no edge function has ever run. There is no Deno
runtime here and no Stripe account to call, so `functions/` is design plus one
executed test of the signature verifier. Everything underneath it — every rule
in the table above — is executed, twice from scratch, against real PostgreSQL.

See `docs/PHASE-0-AUDIT.md` for what stays running meanwhile, and for the three
questions still needing a live environment.
