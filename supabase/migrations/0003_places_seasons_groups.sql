-- =============================================================================
-- 0003 — Locations, seasons, recurring groups, sessions
-- =============================================================================
-- PTP has no permanently reserved facility, so a field is a thing whose
-- availability has to be *verified* before anyone can be scheduled on it. That
-- verification is a column with a date and a person on it, not a flag, because
-- "who said this field was free, and when?" is the question that gets asked
-- after six families turn up to a locked gate.
-- =============================================================================

-- =============================================================================
-- Locations
-- =============================================================================

create table locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address_line  text not null default '',
  city          text not null default '',
  state         text not null default '',
  postal_code   text not null default '',
  latitude      numeric(9,6),
  longitude     numeric(9,6),

  surface       text not null default 'grass' check (surface in ('grass','turf','indoor_court','other')),
  is_indoor     boolean not null default false,
  has_lighting  boolean not null default false,

  -- Permission to be there. A field can be physically available and still not
  -- ours to use.
  permit_status text not null default 'unknown'
                  check (permit_status in ('unknown','permitted','reserved','informal','not_permitted')),
  usage_cost_cents integer not null default 0 check (usage_cost_cents >= 0),

  contact_name  text not null default '',
  contact_phone text not null default '',

  parking_notes text not null default '',
  meeting_instructions text not null default '',
  weather_limitations  text not null default '',

  -- Verification. Nothing recurring is scheduled here until an admin has
  -- confirmed the field is real, free, and ours to use.
  verified_at   timestamptz,
  verified_by   uuid,
  backup_location_id uuid references locations (id),

  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index locations_active_idx on locations (active) where active;

create trigger locations_touch before update on locations
  for each row execute function touch_updated_at();

comment on column locations.verified_at is
  'Set by an admin who confirmed availability. A group cannot be scheduled at a location where this is null — see location_is_schedulable().';

-- Now that locations exists, wire the trainer availability FKs deferred in 0002.
alter table trainer_availability
  add constraint trainer_availability_location_fk
  foreign key (location_id) references locations (id) on delete set null;

alter table trainer_availability_exceptions
  add constraint trainer_availability_exceptions_location_fk
  foreign key (location_id) references locations (id) on delete set null;

-- Field windows: when this location is actually usable by us.
create table field_availability_windows (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations (id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  starts_time  time not null,
  ends_time    time not null,
  effective_from date not null default current_date,
  effective_to   date,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  check (ends_time > starts_time)
);

create index field_windows_lookup on field_availability_windows (location_id, weekday);

-- A location may host recurring groups only once verified and permitted.
create or replace function location_is_schedulable(p_location_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from locations l
    where l.id = p_location_id
      and l.active
      and l.verified_at is not null
      and l.permit_status in ('permitted','reserved','informal')
  );
$$;

-- =============================================================================
-- Seasons
-- =============================================================================

create table seasons (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                     -- "Spring 2026"
  starts_on     date not null,
  ends_on       date not null,
  weeks         smallint not null default 8 check (weeks > 0),

  -- Credits expire at the end of the season unless an admin extends them.
  credits_expire_on date not null,

  status        text not null default 'planned'
                  check (status in ('planned','open','running','completed','canceled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_on > starts_on)
);

create trigger seasons_touch before update on seasons
  for each row execute function touch_updated_at();

comment on column seasons.credits_expire_on is
  'Package credits die here unless extended per-package. Held on the season rather than computed so an admin can move it for everyone at once.';

-- =============================================================================
-- Training groups
-- =============================================================================

create table training_groups (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons (id) on delete cascade,
  name           text not null,                     -- "Tuesday/Thursday U12 Advanced"
  slug           text not null,

  -- Eligibility band. Age is evaluated on the season start date so nobody ages
  -- out mid-season.
  min_age        smallint check (min_age between 4 and 21),
  max_age        smallint check (max_age between 4 and 21),
  min_skill      smallint not null default 1 check (min_skill between 1 and 5),
  max_skill      smallint not null default 5 check (max_skill between 1 and 5),

  location_id    uuid references locations (id),
  trainer_id     uuid references trainers (id),

  -- Capacity. Defaults match the agreed model but every group can differ.
  min_players    smallint not null default 4 check (min_players > 0),
  target_players smallint not null default 5,
  max_players    smallint not null default 6,

  status         group_status not null default 'draft',

  -- Price for a single drop-in into this group, in cents. Null falls back to
  -- the system setting, so a group can be priced differently without a schema
  -- change.
  dropin_price_cents integer check (dropin_price_cents >= 0),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (season_id, slug),
  check (max_age is null or min_age is null or max_age >= min_age),
  check (max_skill >= min_skill),
  check (max_players >= min_players)
);

create index training_groups_season_idx on training_groups (season_id, status);

create trigger training_groups_touch before update on training_groups
  for each row execute function touch_updated_at();

-- A group cannot leave draft without a verified field and an assignable trainer.
-- Enforced here rather than in the application because it is the rule that
-- protects families from turning up somewhere that was never booked.
create or replace function training_groups_guard_activation()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'draft' and old.status = 'draft' then
    if new.location_id is null or not location_is_schedulable(new.location_id) then
      raise exception 'Group % cannot open: its location is not verified and permitted', new.name
        using errcode = 'check_violation';
    end if;

    if new.trainer_id is null or not trainer_is_assignable(new.trainer_id) then
      raise exception 'Group % cannot open: no assignable trainer (active and background-checked)', new.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger training_groups_activation_guard
  before update on training_groups
  for each row execute function training_groups_guard_activation();

-- =============================================================================
-- Recurring meeting times — twice a week per group
-- =============================================================================

create table group_meeting_times (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references training_groups (id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  starts_time  time not null,
  duration_minutes smallint not null default 60 check (duration_minutes > 0),
  created_at   timestamptz not null default now(),
  unique (group_id, weekday, starts_time)
);

comment on table group_meeting_times is
  'Two rows per group in the standard model. Sessions for the season are generated from these by generate_group_sessions().';

-- =============================================================================
-- Sessions — the concrete dated occurrences
-- =============================================================================
-- Group sessions are materialised (unlike private slots, which are computed)
-- because a group session is a commitment with a roster, attendance and a
-- trainer shift attached. It exists whether or not anyone books it.

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  kind          session_kind not null,
  group_id      uuid references training_groups (id) on delete cascade,
  season_id     uuid references seasons (id) on delete cascade,
  trainer_id    uuid references trainers (id),
  location_id   uuid references locations (id),

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,

  status        text not null default 'scheduled'
                  check (status in ('scheduled','in_progress','completed','canceled')),
  canceled_reason text not null default '',

  -- Denormalised for the roster screen and for fast capacity checks. Kept
  -- true by triggers in 0005, never written by hand.
  paid_count    smallint not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (ends_at > starts_at),
  check ((kind = 'group') = (group_id is not null))
);

create index sessions_group_idx   on sessions (group_id, starts_at);
create index sessions_trainer_idx on sessions (trainer_id, starts_at);
create index sessions_upcoming_idx on sessions (starts_at) where status = 'scheduled';

create trigger sessions_touch before update on sessions
  for each row execute function touch_updated_at();

-- A trainer cannot be in two places at once. The exclusion constraint makes
-- double-booking impossible at the database level rather than merely checked.
alter table sessions
  add constraint sessions_no_trainer_overlap
  exclude using gist (
    trainer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'canceled' and trainer_id is not null);

-- Nor can a field host two sessions at once.
alter table sessions
  add constraint sessions_no_location_overlap
  exclude using gist (
    location_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'canceled' and location_id is not null);

comment on constraint sessions_no_trainer_overlap on sessions is
  'Double-booking a trainer is rejected by the database. An application check has a race between the read and the write; this does not.';

-- =============================================================================
-- Generate a season's group sessions
-- =============================================================================

create or replace function generate_group_sessions(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group    training_groups%rowtype;
  v_season   seasons%rowtype;
  v_time     group_meeting_times%rowtype;
  v_date     date;
  v_created  integer := 0;
begin
  select * into v_group from training_groups where id = p_group_id;
  if not found then
    raise exception 'Unknown group %', p_group_id;
  end if;

  select * into v_season from seasons where id = v_group.season_id;

  for v_time in
    select * from group_meeting_times where group_id = p_group_id
  loop
    v_date := v_season.starts_on;

    -- Walk forward to the first matching weekday, then step a week at a time.
    while extract(dow from v_date)::smallint <> v_time.weekday loop
      v_date := v_date + 1;
    end loop;

    while v_date <= v_season.ends_on loop
      -- on conflict do nothing so regenerating a season is safe
      insert into sessions (kind, group_id, season_id, trainer_id, location_id, starts_at, ends_at)
      values (
        'group',
        v_group.id,
        v_group.season_id,
        v_group.trainer_id,
        v_group.location_id,
        (v_date + v_time.starts_time) at time zone current_setting('TimeZone'),
        (v_date + v_time.starts_time + make_interval(mins => v_time.duration_minutes)) at time zone current_setting('TimeZone')
      )
      on conflict do nothing;

      v_created := v_created + 1;
      v_date := v_date + 7;
    end loop;
  end loop;

  perform write_audit('system', null, 'group.sessions_generated', 'training_groups', p_group_id,
                      null, jsonb_build_object('sessions', v_created));

  return v_created;
end;
$$;

comment on function generate_group_sessions is
  'Materialises every dated session for a group across its season. Safe to re-run: existing sessions are left alone.';
