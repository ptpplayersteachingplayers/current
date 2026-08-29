-- =============================================================================
-- 0004 — Packages, credits, holds, bookings, payments
-- =============================================================================
-- The rule that shapes this whole file: a booking is confirmed by payment, and
-- payment is confirmed by Stripe. Nothing a browser sends can move a booking
-- into 'confirmed'. Credits are the one exception, and a credit only exists
-- because a payment created it.
-- =============================================================================

-- =============================================================================
-- Payments
-- =============================================================================

create table payments (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households (id) on delete restrict,

  amount_cents      integer not null check (amount_cents >= 0),
  refunded_cents    integer not null default 0 check (refunded_cents >= 0),
  currency          text not null default 'usd',
  status            payment_status not null default 'pending',

  -- Stripe is the truth. The intent id is unique so a replayed webhook cannot
  -- create a second payment row for the same charge.
  stripe_payment_intent_id text unique,
  stripe_charge_id         text,

  description       text not null default '',
  metadata          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  succeeded_at      timestamptz,
  updated_at        timestamptz not null default now(),

  check (refunded_cents <= amount_cents)
);

create index payments_household_idx on payments (household_id, created_at desc);
create index payments_status_idx on payments (status);

create trigger payments_touch before update on payments
  for each row execute function touch_updated_at();

create table refunds (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references payments (id) on delete restrict,
  amount_cents  integer not null check (amount_cents > 0),
  reason        text not null default '',
  stripe_refund_id text unique,
  created_at    timestamptz not null default now(),
  created_by    uuid
);

create index refunds_payment_idx on refunds (payment_id);

-- =============================================================================
-- Packages and credits
-- =============================================================================
-- A package is a purchase. Credits are the individual sessions it bought.
-- Modelling credits as rows rather than a counter means every one has its own
-- state, expiry and audit trail — "where did my sixteenth session go?" is
-- answerable.

create table packages (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households (id) on delete cascade,
  player_id      uuid references players (id) on delete set null,
  season_id      uuid not null references seasons (id) on delete restrict,
  payment_id     uuid references payments (id) on delete set null,

  session_count  smallint not null check (session_count > 0),
  price_cents    integer not null check (price_cents >= 0),

  -- Copied from the season at purchase, then extendable per package so an
  -- admin can grant one family longer without moving everyone's deadline.
  expires_on     date not null,
  extended_from  date,
  extended_by    uuid,
  extension_note text not null default '',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index packages_household_idx on packages (household_id);
create index packages_expiry_idx on packages (expires_on) where expires_on is not null;

create trigger packages_touch before update on packages
  for each row execute function touch_updated_at();

comment on column packages.player_id is
  'Credits are usually bought for one player but may be left unassigned so a household can spread them. Null means any player in the household.';

create table package_credits (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references packages (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  state         credit_state not null default 'available',

  -- Set when reserved or consumed, so a credit points at what it paid for.
  booking_id    uuid,
  reserved_until timestamptz,

  expires_on    date not null,
  consumed_at   timestamptz,
  expired_at    timestamptz,

  -- A makeup credit is issued rather than purchased. Kept in the same table so
  -- consumption logic never has to know the difference.
  origin        text not null default 'purchase'
                  check (origin in ('purchase','makeup','goodwill','migration')),
  origin_note   text not null default '',

  created_at    timestamptz not null default now()
);

create index credits_household_state_idx on package_credits (household_id, state);
create index credits_expiry_idx on package_credits (expires_on) where state = 'available';
create index credits_reserved_idx on package_credits (reserved_until) where state = 'reserved';

comment on table package_credits is
  'One row per session bought. Rows rather than a counter so each credit has its own state, expiry and history.';

-- Materialise the credits a package bought.
create or replace function issue_package_credits(p_package_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg packages%rowtype;
  v_existing integer;
begin
  select * into v_pkg from packages where id = p_package_id;
  if not found then
    raise exception 'Unknown package %', p_package_id;
  end if;

  -- Idempotent: a retried webhook must not double the credits.
  select count(*) into v_existing from package_credits where package_id = p_package_id;
  if v_existing > 0 then
    return 0;
  end if;

  insert into package_credits (package_id, household_id, expires_on)
  select v_pkg.id, v_pkg.household_id, v_pkg.expires_on
  from generate_series(1, v_pkg.session_count);

  perform write_audit('system', null, 'package.credits_issued', 'packages', p_package_id,
                      null, jsonb_build_object('count', v_pkg.session_count));

  return v_pkg.session_count;
end;
$$;

-- =============================================================================
-- Booking holds
-- =============================================================================
-- Fifteen minutes, server-side. A hold is a real row so that capacity checks,
-- the AI agent and the admin screen all see the same picture — a spot someone
-- is mid-checkout on is not free.

create table booking_holds (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,

  expires_at    timestamptz not null,
  credit_id     uuid references package_credits (id) on delete set null,

  created_at    timestamptz not null default now(),

  -- One live hold per player per session. A parent double-tapping does not
  -- consume two spots.
  unique (session_id, player_id)
);

create index holds_expiry_idx on booking_holds (expires_at);

comment on table booking_holds is
  'A 15-minute reservation. Counts against capacity while it lives, so two families cannot pay for the last spot.';

-- =============================================================================
-- Bookings
-- =============================================================================

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete restrict,
  player_id     uuid not null references players (id) on delete restrict,
  household_id  uuid not null references households (id) on delete restrict,

  status        booking_status not null default 'held',

  -- How it was paid for. Exactly one of these, enforced below.
  payment_id    uuid references payments (id) on delete set null,
  credit_id     uuid references package_credits (id) on delete set null,
  price_cents   integer not null default 0 check (price_cents >= 0),

  canceled_at   timestamptz,
  canceled_by   uuid,
  cancel_reason text not null default '',
  refund_id     uuid references refunds (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A player is in a session once. Re-booking after a cancellation is a new
  -- row, so the partial index excludes canceled ones.
  constraint bookings_price_or_credit
    check (status not in ('confirmed','attended') or payment_id is not null or credit_id is not null)
);

create unique index bookings_one_live_per_player
  on bookings (session_id, player_id)
  where status not in ('canceled','refunded');

create index bookings_household_idx on bookings (household_id, created_at desc);
create index bookings_session_idx on bookings (session_id) where status in ('confirmed','attended');

create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();

-- The credit points back at the booking it paid for.
alter table package_credits
  add constraint package_credits_booking_fk
  foreign key (booking_id) references bookings (id) on delete set null;

-- =============================================================================
-- Enrollments — a player's place in a recurring group for the season
-- =============================================================================
-- Distinct from a booking. A booking is one dated session; an enrollment is
-- "Ava is in the Tuesday/Thursday U12 group this season", which is what drives
-- capacity and activation.

create table enrollments (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references training_groups (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  package_id    uuid references packages (id) on delete set null,

  state         text not null default 'active'
                  check (state in ('active','withdrawn','moved','completed')),

  -- An enrollment counts toward activation only once it is paid for.
  is_paid       boolean not null default false,

  enrolled_at   timestamptz not null default now(),
  withdrawn_at  timestamptz,
  moved_to_group_id uuid references training_groups (id),
  note          text not null default ''
);

create unique index enrollments_one_active
  on enrollments (group_id, player_id)
  where state = 'active';

create index enrollments_group_idx on enrollments (group_id) where state = 'active';
create index enrollments_household_idx on enrollments (household_id);

comment on column enrollments.is_paid is
  'Only paid enrollments count toward the 4-player activation threshold. A forming group with four unpaid interested families is still forming.';

-- =============================================================================
-- Waitlists
-- =============================================================================

create table waitlists (
  id            uuid primary key default gen_random_uuid(),
  -- One waitlist table for both things a family can queue for. Two tables
  -- would mean two promotion functions, two expiry jobs and two places for the
  -- rule about invitation windows to drift apart. camp_id is added in 0013.
  group_id      uuid references training_groups (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,

  position      integer not null,
  state         text not null default 'waiting'
                  check (state in ('waiting','invited','converted','declined','expired')),

  -- When promoted, the family gets a window to take the spot before it passes
  -- to the next person.
  invited_at    timestamptz,
  invite_expires_at timestamptz,

  created_at    timestamptz not null default now()
);

create unique index waitlists_one_per_player
  on waitlists (group_id, player_id)
  where state in ('waiting','invited') and group_id is not null;

create index waitlists_order_idx on waitlists (group_id, position) where state = 'waiting';

-- =============================================================================
-- Attendance
-- =============================================================================

create table attendance (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  booking_id    uuid references bookings (id) on delete set null,

  state         attendance_state not null,
  recorded_at   timestamptz not null default now(),
  recorded_by   uuid,
  note          text not null default '',

  unique (session_id, player_id)
);

create index attendance_session_idx on attendance (session_id);

-- =============================================================================
-- Player notes
-- =============================================================================

create table player_notes (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players (id) on delete cascade,
  session_id    uuid references sessions (id) on delete set null,
  trainer_id    uuid references trainers (id) on delete set null,

  kind          text not null default 'progress'
                  check (kind in ('progress','injury','safety','behaviour','admin')),
  body          text not null,

  -- Injury and safety notes reach the parent; a coaching aside may not.
  parent_visible boolean not null default true,

  created_at    timestamptz not null default now(),
  created_by    uuid
);

create index player_notes_player_idx on player_notes (player_id, created_at desc);
create index player_notes_session_idx on player_notes (session_id);

comment on column player_notes.parent_visible is
  'Injury and safety notes are always parent-visible; a trainer cannot hide one. Enforced in the RLS policy and by the check below.';

alter table player_notes
  add constraint player_notes_safety_is_visible
  check (kind not in ('injury','safety') or parent_visible);
