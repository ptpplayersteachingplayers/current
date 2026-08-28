-- =============================================================================
-- 0002 — People: households, contacts, players, trainers
-- =============================================================================
-- The household is the account, not the parent. That is the central change from
-- the old WordPress model, where a parent row *was* the customer — which made
-- two parents sharing children impossible to represent without duplicating the
-- children.
--
-- household ──< contacts        (both parents, a grandparent, a nanny)
--           └─< players         (the children)
--
-- A contact signs in; the household owns the money and the bookings.
-- =============================================================================

-- =============================================================================
-- Households
-- =============================================================================

create table households (
  id                  uuid primary key default gen_random_uuid(),
  display_name        text not null,             -- "The Martelli family"
  stripe_customer_id  text unique,
  -- External ids, so a migrated record can be traced back to its origin and a
  -- re-run of the migration updates rather than duplicates.
  legacy_parent_id    bigint unique,             -- ptp_parents.id
  hubspot_company_id  text unique,
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger households_touch before update on households
  for each row execute function touch_updated_at();

-- =============================================================================
-- Contacts — the people who sign in
-- =============================================================================

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households (id) on delete cascade,
  auth_user_id  uuid unique,               -- auth.users.id; null until they register
  first_name    text not null default '',
  last_name     text not null default '',
  email         citext,
  phone         text,                      -- E.164
  is_primary    boolean not null default false,
  -- Marketing and CRM linkage
  hubspot_contact_id text unique,
  legacy_parent_id   bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Email and phone are the two natural keys the AI agent and Stripe will match
-- on. Both unique where present, so a second signup with the same email joins
-- the existing household rather than forking it.
create unique index contacts_email_key on contacts (lower(email)) where email is not null;
create unique index contacts_phone_key on contacts (phone) where phone is not null;
create index contacts_household_idx on contacts (household_id);

create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

comment on column contacts.is_primary is
  'The contact the AI agent addresses by default. Exactly one per household is enforced by contacts_one_primary.';

create unique index contacts_one_primary
  on contacts (household_id) where is_primary;

-- =============================================================================
-- Players
-- =============================================================================

create table players (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households (id) on delete cascade,
  first_name     text not null,
  last_name      text not null default '',
  birth_date     date,
  -- Ability level drives group eligibility. Stored as an ordered integer so
  -- "level 2 or 3" is a range check rather than a set membership test.
  skill_level    smallint not null default 2 check (skill_level between 1 and 5),
  club_team      text not null default '',
  position       text not null default '',
  medical_notes  text not null default '',
  legacy_player_id bigint unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index players_household_idx on players (household_id);
create index players_birth_idx on players (birth_date);

create trigger players_touch before update on players
  for each row execute function touch_updated_at();

comment on column players.skill_level is
  '1 recreational … 5 elite. Ordered so eligibility is a BETWEEN, and so a group can widen its band without a data migration.';

-- Age in years at a given date. Groups are age-banded on the date the season
-- starts, not on today, so a player does not age out mid-season.
create or replace function player_age_on(p_birth_date date, p_on date)
returns integer
language sql
immutable
as $$
  select case
    when p_birth_date is null then null
    else extract(year from age(p_on, p_birth_date))::integer
  end;
$$;

-- =============================================================================
-- Player availability
-- =============================================================================
-- What a family can actually make. Used to recommend groups, never to block a
-- booking — a parent who wants an inconvenient slot may still have it.

create table player_availability (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  starts_time time not null,
  ends_time   time not null,
  created_at  timestamptz not null default now(),
  check (ends_time > starts_time)
);

create index player_availability_player_idx on player_availability (player_id, weekday);

-- =============================================================================
-- Trainers
-- =============================================================================

create table trainers (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique,
  display_name       text not null,
  slug               text not null unique,
  bio                text not null default '',
  phone              text,
  email              citext,

  -- Pay. A fixed amount per scheduled hour, set per trainer — not a share of
  -- what the parent paid. $40/hr initially. What a parent is charged lives on
  -- the group or the private rate setting, deliberately unconnected: a
  -- discount comes out of margin, never out of trainer pay.
  hourly_pay_cents   integer not null default 0 check (hourly_pay_cents >= 0),

  status             text not null default 'pending'
                       check (status in ('pending','active','paused','archived')),

  -- Compliance. A trainer cannot be assigned to a group without these.
  background_check_status text not null default 'not_started'
                       check (background_check_status in ('not_started','pending','cleared','expired','failed')),
  background_check_expires_at date,
  qualifications     jsonb not null default '[]'::jsonb,

  -- Payouts. Copied from the legacy system, never regenerated — a second
  -- onboarding creates a second Stripe account and splits payment history.
  stripe_account_id  text unique,
  legacy_trainer_id  bigint unique,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index trainers_status_idx on trainers (status) where status = 'active';

create trigger trainers_touch before update on trainers
  for each row execute function touch_updated_at();

comment on column trainers.hourly_pay_cents is
  'What this trainer earns per scheduled hour. Paid for the whole block once confirmed, regardless of how many players attend a given session.';

-- A trainer may only be assigned to work when they are active and cleared.
create or replace function trainer_is_assignable(p_trainer_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from trainers t
    where t.id = p_trainer_id
      and t.status = 'active'
      and t.background_check_status = 'cleared'
      and (t.background_check_expires_at is null or t.background_check_expires_at >= current_date)
  );
$$;

-- =============================================================================
-- Trainer availability
-- =============================================================================
-- What the trainer offers. Blocks are built inside these windows; nothing is
-- ever scheduled outside one.

create table trainer_availability (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   uuid not null references trainers (id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  starts_time  time not null,
  ends_time    time not null,
  location_id  uuid,                    -- FK added in 0003, after locations exists
  kind         session_kind,            -- null = will work either
  effective_from date not null default current_date,
  effective_to   date,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (ends_time > starts_time),
  check (effective_to is null or effective_to >= effective_from)
);

create index trainer_availability_lookup
  on trainer_availability (trainer_id, weekday) where active;

-- One-off overrides: a holiday, or an extra weekend opened for a tournament.
create table trainer_availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references trainers (id) on delete cascade,
  on_date     date not null,
  kind        text not null default 'block' check (kind in ('block','open')),
  starts_time time,
  ends_time   time,
  location_id uuid,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  unique (trainer_id, on_date, kind, starts_time)
);
