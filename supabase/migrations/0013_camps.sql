-- =============================================================================
-- 0013 — Camps
-- =============================================================================
-- One camp record, one detail template. The old site had a hand-built page per
-- camp, which is why it accumulated duplicate listings, $0 prices and camps
-- that had already happened still taking registrations. Here a camp is a row,
-- and publishing it is what puts it in the finder, on the state page, in the
-- parent portal, in the trainer staffing queue and in the agent's knowledge.
--
-- The registration flow is the same shape as the group one: a hold, then
-- Stripe, then a webhook. Nothing a browser sends confirms a place.
-- =============================================================================

create type camp_status as enum (
  'draft',              -- being set up, invisible
  'early_access',       -- collecting interest, not selling
  'registration_open',
  'limited',            -- under the low-availability threshold
  'full',
  'waitlist',
  'completed',
  'canceled',
  'archived'            -- past, and out of the active listings
);

create type camp_day_option as enum ('full_day', 'half_day');

-- =============================================================================
-- Postal centroids
-- =============================================================================
-- "Camps near 19401" needs a point for the ZIP. This is a small table rather
-- than a call to a geocoding service on every search: the answer never
-- changes, and a camp finder that stops working because an API key expired is
-- a bad trade. Seeded for the counties PTP serves; a fuller file loads from
-- the census gazetteer at deploy.

create table postal_centroids (
  postal_code  text primary key,
  city         text not null default '',
  state        text not null default '',
  latitude     numeric(9,6) not null,
  longitude    numeric(9,6) not null
);

-- Miles between two points. Haversine rather than PostGIS: one function, no
-- extension, and accurate to well under a mile at the distances a parent will
-- drive to a soccer camp.
create or replace function miles_between(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
)
returns numeric
language sql
immutable
as $$
  select round((
    3958.7613 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)
    ))
  )::numeric, 1);
$$;

-- =============================================================================
-- Camps
-- =============================================================================

create table camps (
  id                 uuid primary key default gen_random_uuid(),

  name               text not null,
  slug               text not null unique,
  season_year        smallint not null,
  program_type       text not null default 'summer_camp'
                       check (program_type in ('summer_camp','winter_clinic','holiday_camp','clinic','event')),

  -- Where. Denormalised from the location because a camp's public address is
  -- part of its record and must not shift when a field row is edited.
  location_id        uuid references locations (id),
  region             text not null default '',
  state              text not null default '',
  city               text not null default '',
  postal_code        text not null default '',
  field_name         text not null default '',
  address_line       text not null default '',
  latitude           numeric(9,6),
  longitude          numeric(9,6),

  -- When
  starts_on          date not null,
  ends_on            date not null,
  daily_starts_at    time not null default '09:00',
  daily_ends_at      time not null default '15:00',
  half_day_ends_at   time,

  -- Who
  min_age            smallint not null default 6 check (min_age between 4 and 21),
  max_age            smallint not null default 14 check (max_age between 4 and 21),

  -- What it costs. Integer cents, like everything else.
  full_day_price_cents integer check (full_day_price_cents >= 0),
  half_day_price_cents integer check (half_day_price_cents >= 0),
  offers_full_day    boolean not null default true,
  offers_half_day    boolean not null default false,

  capacity           smallint not null default 60 check (capacity > 0),
  low_availability_at smallint not null default 10,

  status             camp_status not null default 'draft',

  camp_director_id   uuid references trainers (id),

  -- Content for the detail page. Text and jsonb rather than a pile of
  -- columns, because this is copy, not data anything computes on.
  featured_image_url text not null default '',
  gallery            jsonb not null default '[]'::jsonb,
  description        text not null default '',
  whats_included     jsonb not null default '[]'::jsonb,
  what_to_bring      jsonb not null default '[]'::jsonb,
  daily_schedule     jsonb not null default '[]'::jsonb,
  faqs               jsonb not null default '[]'::jsonb,
  weather_plan       text not null default '',
  refund_policy      text not null default '',
  offers_protection  boolean not null default false,

  -- Can this camp actually run? Same idea as the field verification in 0003:
  -- nothing is sold on a field nobody has confirmed.
  field_approved     boolean not null default false,
  permit_status      text not null default 'unknown',
  insurance_status   text not null default 'unknown'
                       check (insurance_status in ('unknown','requested','received','not_required')),

  -- The systems this camp exists in besides ours.
  stripe_product_id     text,
  stripe_full_price_id  text,
  stripe_half_price_id  text,
  wordpress_page_id     bigint,
  hubspot_campaign_id   text,
  hubspot_list_id       text,
  legacy_product_id     bigint,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  check (ends_on >= starts_on),
  check (max_age >= min_age),
  check (not offers_full_day or full_day_price_cents is not null),
  check (not offers_half_day or half_day_price_cents is not null)
);

create index camps_finder_idx on camps (state, starts_on)
  where status in ('registration_open','limited','waitlist','early_access');
create index camps_slug_idx on camps (slug);
create index camps_point_idx on camps (latitude, longitude);

create trigger camps_touch before update on camps
  for each row execute function touch_updated_at();

comment on table camps is
  'One row per camp. Publishing it is what populates the finder, the state page, the detail page, the portal, the staffing queue and the agent — not a hand-built page per camp.';

-- The individual days. A camp is sold as a week; it is *run* as five days, and
-- attendance, staffing and a parent asking "is Thursday still on?" all need a
-- row per day.
create table camp_sessions (
  id          uuid primary key default gen_random_uuid(),
  camp_id     uuid not null references camps (id) on delete cascade,
  session_date date not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'scheduled'
                check (status in ('scheduled','in_progress','completed','canceled','weather_canceled')),
  notes       text not null default '',
  created_at  timestamptz not null default now(),

  unique (camp_id, session_date)
);

create index camp_sessions_camp_idx on camp_sessions (camp_id, session_date);

-- Who is working it.
create table camp_staffing (
  id          uuid primary key default gen_random_uuid(),
  camp_id     uuid not null references camps (id) on delete cascade,
  trainer_id  uuid not null references trainers (id) on delete cascade,
  role        text not null default 'coach'
                check (role in ('director','coach','assistant','goalkeeper_coach')),
  is_featured boolean not null default false,
  status      text not null default 'proposed'
                check (status in ('proposed','accepted','declined','removed')),
  created_at  timestamptz not null default now(),

  unique (camp_id, trainer_id)
);

-- Optional extras: before and after care, camp protection.
create table camp_addons (
  id           uuid primary key default gen_random_uuid(),
  camp_id      uuid not null references camps (id) on delete cascade,
  code         text not null,
  name         text not null,
  description  text not null default '',
  price_cents  integer not null check (price_cents >= 0),
  capacity     smallint,
  active       boolean not null default true,

  unique (camp_id, code)
);

-- =============================================================================
-- Registrations
-- =============================================================================

create table camp_registrations (
  id            uuid primary key default gen_random_uuid(),
  camp_id       uuid not null references camps (id) on delete restrict,
  player_id     uuid not null references players (id) on delete restrict,
  household_id  uuid not null references households (id) on delete restrict,

  day_option    camp_day_option not null default 'full_day',

  status        text not null default 'held'
                  check (status in ('held','payment_pending','confirmed','attended','canceled','refunded','no_show')),

  payment_id    uuid references payments (id) on delete set null,
  price_cents   integer not null default 0 check (price_cents >= 0),

  -- Everything a camp needs on the morning and cannot chase on the day.
  emergency_contact_name  text not null default '',
  emergency_contact_phone text not null default '',
  authorized_pickup       text not null default '',
  medical_notes           text not null default '',
  allergies               text not null default '',
  shirt_size              text not null default '',

  -- Agreed, with when. A tick box with no timestamp is not a consent record.
  waiver_agreed_at        timestamptz,
  media_release_agreed_at timestamptz,
  conduct_agreed_at       timestamptz,
  refund_policy_agreed_at timestamptz,
  medical_auth_agreed_at  timestamptz,

  canceled_at   timestamptz,
  cancel_reason text not null default '',
  refund_id     uuid references refunds (id) on delete set null,

  hubspot_deal_id text,
  legacy_order_id bigint,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A confirmed registration has been paid for. Same rule as bookings.
  constraint camp_registrations_paid
    check (status not in ('confirmed','attended') or payment_id is not null or price_cents = 0)
);

-- A player is registered for a camp once. Cancelling and coming back is a new
-- row, so the partial index excludes the dead ones.
create unique index camp_registrations_one_live
  on camp_registrations (camp_id, player_id)
  where status not in ('canceled','refunded');

create index camp_registrations_household_idx on camp_registrations (household_id, created_at desc);
create index camp_registrations_camp_idx on camp_registrations (camp_id)
  where status in ('confirmed','attended');

create trigger camp_registrations_touch before update on camp_registrations
  for each row execute function touch_updated_at();

create table camp_registration_addons (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references camp_registrations (id) on delete cascade,
  addon_id        uuid not null references camp_addons (id) on delete restrict,
  price_cents     integer not null check (price_cents >= 0),
  unique (registration_id, addon_id)
);

-- Holds, exactly as for training: a place someone is mid-checkout on is not
-- free, and it stops being held on its own.
create table camp_holds (
  id            uuid primary key default gen_random_uuid(),
  camp_id       uuid not null references camps (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  day_option    camp_day_option not null default 'full_day',
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),

  unique (camp_id, player_id)
);

create index camp_holds_expiry_idx on camp_holds (expires_at);

-- A waitlist entry belongs to a group or a camp, and to exactly one of them.
alter table waitlists
  add column camp_id uuid references camps (id) on delete cascade;

alter table waitlists
  add constraint waitlists_one_subject
  check (num_nonnulls(group_id, camp_id) = 1);

create unique index waitlists_one_per_player_camp
  on waitlists (camp_id, player_id)
  where state in ('waiting','invited') and camp_id is not null;

create index waitlists_camp_order_idx on waitlists (camp_id, position)
  where state = 'waiting';

-- =============================================================================
-- Early access
-- =============================================================================
-- A camp that is not on sale yet still has demand worth capturing, and the
-- honest thing to tell a family is that this is interest, not a place.

create table camp_interest (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households (id) on delete set null,
  contact_id    uuid references contacts (id) on delete set null,
  player_id     uuid references players (id) on delete set null,

  parent_name   text not null default '',
  phone         text,
  email         citext,
  postal_code   text not null default '',
  player_name   text not null default '',
  player_age    smallint,

  preferred_location text not null default '',
  preferred_weeks    jsonb not null default '[]'::jsonb,
  day_preference     camp_day_option,

  season_year   smallint not null,
  camp_id       uuid references camps (id) on delete set null,

  -- Set when this interest turns into an actual registration, so the follow-up
  -- job stops chasing them.
  converted_at  timestamptz,
  hubspot_contact_id text,

  created_at    timestamptz not null default now()
);

create index camp_interest_open_idx on camp_interest (season_year, created_at)
  where converted_at is null;
create index camp_interest_postal_idx on camp_interest (postal_code);

comment on table camp_interest is
  'Early access. Deliberately not a booking: nothing here reserves a place, and the confirmation message says so.';

-- =============================================================================
-- Capacity and status
-- =============================================================================

create or replace function camp_occupancy(p_camp_id uuid)
returns table (paid integer, held integer, total integer, capacity integer, waitlisted integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from camp_registrations r
      where r.camp_id = p_camp_id and r.status in ('confirmed','attended')),
    (select count(*)::integer from camp_holds h
      where h.camp_id = p_camp_id and h.expires_at > now()),
    (select count(*)::integer from camp_registrations r
      where r.camp_id = p_camp_id and r.status in ('confirmed','attended'))
    + (select count(*)::integer from camp_holds h
      where h.camp_id = p_camp_id and h.expires_at > now()),
    (select c.capacity::integer from camps c where c.id = p_camp_id),
    (select count(*)::integer from waitlists w
      where w.camp_id = p_camp_id and w.state in ('waiting','invited'));
$$;

create or replace function camp_has_space(p_camp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select total < capacity from camp_occupancy(p_camp_id)), false);
$$;

-- The only writer of camp status, for the same reason recompute_group_status()
-- is the only writer of group status: two places deciding a status is two
-- places that will eventually disagree.
create or replace function recompute_camp_status(p_camp_id uuid)
returns camp_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp camps%rowtype;
  v_o    record;
  v_new  camp_status;
begin
  select * into v_camp from camps where id = p_camp_id for update;
  if not found then
    raise exception 'Unknown camp' using errcode = 'no_data_found';
  end if;

  -- Hand-set states are not ours to move.
  if v_camp.status in ('draft','early_access','canceled','archived') then
    return v_camp.status;
  end if;

  select * into v_o from camp_occupancy(p_camp_id);

  if v_camp.ends_on < current_date then
    v_new := 'completed';
  elsif v_o.total >= v_o.capacity then
    v_new := 'full';
  elsif v_o.capacity - v_o.total <= v_camp.low_availability_at then
    v_new := 'limited';
  else
    v_new := 'registration_open';
  end if;

  if v_new is distinct from v_camp.status then
    update camps set status = v_new where id = p_camp_id;

    perform write_audit('system', null, 'camp.status_changed', 'camps', p_camp_id,
                        jsonb_build_object('status', v_camp.status),
                        jsonb_build_object('status', v_new, 'paid', v_o.paid));
  end if;

  return v_new;
end;
$$;

create or replace function camp_registrations_after_change()
returns trigger
language plpgsql
as $$
begin
  perform recompute_camp_status(coalesce(new.camp_id, old.camp_id));
  return null;
end;
$$;

create trigger camp_registrations_recompute
  after insert or update or delete on camp_registrations
  for each row execute function camp_registrations_after_change();

-- Nothing opens on a field nobody has approved, without insurance, or with a
-- price missing. The same guard 0003 puts on training groups.
create or replace function camps_guard_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('registration_open','limited','full','waitlist')
     and (old.status is null or old.status in ('draft','early_access')) then

    if not new.field_approved then
      raise exception 'Camp % cannot open: the field is not approved', new.name
        using errcode = 'check_violation';
    end if;

    if new.insurance_status not in ('received','not_required') then
      raise exception 'Camp % cannot open: no certificate of insurance', new.name
        using errcode = 'check_violation';
    end if;

    if new.offers_full_day and coalesce(new.full_day_price_cents, 0) = 0 then
      raise exception 'Camp % cannot open at $0', new.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger camps_guard before update on camps
  for each row execute function camps_guard_publication();

-- =============================================================================
-- Days
-- =============================================================================

create or replace function generate_camp_days(p_camp_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp camps%rowtype;
  v_tz   text := setting_text('display_timezone', 'America/New_York');
  v_day  date;
  v_n    integer := 0;
begin
  select * into v_camp from camps where id = p_camp_id;
  if not found then
    raise exception 'Unknown camp' using errcode = 'no_data_found';
  end if;

  v_day := v_camp.starts_on;

  while v_day <= v_camp.ends_on loop
    -- Weekends are skipped: a five-day camp runs Monday to Friday.
    if extract(dow from v_day) between 1 and 5 then
      insert into camp_sessions (camp_id, session_date, starts_at, ends_at)
      values (
        p_camp_id, v_day,
        ((v_day + v_camp.daily_starts_at) at time zone v_tz),
        ((v_day + v_camp.daily_ends_at)   at time zone v_tz)
      )
      on conflict (camp_id, session_date) do nothing;

      v_n := v_n + 1;
    end if;

    v_day := v_day + 1;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- The finder
-- =============================================================================
-- One function behind the ZIP search, the state page and the city page, so all
-- three agree about what is on sale.

create or replace function camps_near(
  p_postal_code text default null,
  p_radius_miles numeric default 40,
  p_state text default null,
  p_city text default null,
  p_age smallint default null,
  p_day_option camp_day_option default null,
  p_from date default current_date,
  p_to date default null
)
returns table (
  camp_id uuid,
  distance_miles numeric,
  spots_left integer,
  status camp_status
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select latitude as lat, longitude as lon
    from postal_centroids
    where postal_code = p_postal_code
  )
  select
    c.id,
    case when p_postal_code is null or o.lat is null then null
         else miles_between(o.lat, o.lon, c.latitude, c.longitude) end,
    greatest(0, occ.capacity - occ.total),
    c.status
  from camps c
  cross join lateral camp_occupancy(c.id) occ
  left join origin o on true
  -- Full camps stay in the results on purpose: a family who cannot register
  -- can still join the waitlist, and hiding the week they wanted is how they
  -- conclude PTP does not run near them.
  where c.status in ('registration_open','limited','full','waitlist','early_access')
    and c.starts_on >= p_from
    and (p_to is null or c.starts_on <= p_to)
    and (p_state is null or c.state = p_state)
    and (p_city  is null or c.city  = p_city)
    and (p_age   is null or (p_age between c.min_age and c.max_age))
    and (p_day_option is null
         or (p_day_option = 'full_day' and c.offers_full_day)
         or (p_day_option = 'half_day' and c.offers_half_day))
    -- No origin, no distance filter: the finder still works for a parent who
    -- would rather browse by state than type a ZIP.
    and (p_postal_code is null or o.lat is null
         or miles_between(o.lat, o.lon, c.latitude, c.longitude) <= p_radius_miles)
  order by 2 nulls last, c.starts_on;
$$;

comment on function camps_near is
  'The one query behind the ZIP finder, the state page and the city page. A camp missing from one of them is missing from all three, which is the point.';
