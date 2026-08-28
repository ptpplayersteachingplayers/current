# PTP Supabase — Phase 1

The Supabase foundation for the year-round training operation: schema,
migrations, RLS, functions and seed data.

**Nothing here is deployed.** The WordPress private-training system stays live
and untouched until this is proven.

## Verify it

```bash
./verify.sh                       # builds a throwaway DB and asserts the rules
PGHOST=/var/run/postgresql ./verify.sh
```

22 assertions covering the seeded state, the guards, capacity, the block rule
and trainer pay. Verified against PostgreSQL 16.

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

## Two conventions

**Money is integer cents.** Never numeric, never float. Rounding is decided
explicitly in one place.

**Duplicate protection is a constraint, not a check.** An application check has
a race between the read and the write; payment webhooks retry into that race.

## Local Postgres, for reference

```bash
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /tmp/pgtest/data -U postgres --auth=trust
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest/data \
  -o '-k /tmp/pgtest/sock -p 5433 -c listen_addresses=' -l /tmp/pgtest/log start
```

`auth.uid()` and `auth.jwt()` are stubbed by `verify.sh`; Supabase provides
them in production.

## Not built yet

Phase 2 onward: Stripe and Quo edge functions, HubSpot sync, the WordPress
API bridge, the AI follow-up agent, cron tiers, and the parent, trainer and
admin interfaces. See `docs/PHASE-0-AUDIT.md` for what stays running meanwhile.
