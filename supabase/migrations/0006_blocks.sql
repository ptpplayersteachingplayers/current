-- =============================================================================
-- 0006 — Trainer blocks: no isolated trips
-- =============================================================================
-- This inverts the rule the old WordPress engine was built on. There, a slot
-- was offered on its own merits. Here a slot is only offered if it *joins
-- something* — because sending a trainer across town for one paid hour loses
-- money and goodwill at once.
--
-- The rules, as agreed:
--
--   1. A confirmed group session anchors a block. Privates may attach directly
--      before or after it.
--   2. A weekend private block needs at least two consecutive paid sessions
--      before the trainer is committed.
--   3. Isolated private slots are never offered.
--   4. If a cancellation later leaves one session in an already-confirmed
--      block, the remaining family is honoured and the trainer is still paid.
--      We do not punish family B for family A's cancellation.
--   5. An admin can override any of it.
-- =============================================================================

-- =============================================================================
-- Trainer shifts — the block itself
-- =============================================================================

create table trainer_shifts (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    uuid not null references trainers (id) on delete cascade,
  location_id   uuid references locations (id),

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,

  status        shift_status not null default 'proposed',

  -- A block anchored by a confirmed group never needs the two-session test:
  -- the trainer is already travelling for the group.
  anchor_session_id uuid references sessions (id) on delete set null,

  -- Set when an admin waives the minimum. Recorded with who and why, because
  -- the override is the exception the rule exists to make visible.
  override_by   uuid,
  override_reason text not null default '',

  -- Pay is computed from scheduled hours, not attendance. Once confirmed, the
  -- trainer is paid for the block whoever turns up.
  hourly_pay_cents integer not null default 0 check (hourly_pay_cents >= 0),
  paid_out_at   timestamptz,

  acknowledged_at timestamptz,
  confirmed_at  timestamptz,
  completed_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (ends_at > starts_at)
);

create index trainer_shifts_trainer_idx on trainer_shifts (trainer_id, starts_at);
create index trainer_shifts_pending_idx on trainer_shifts (status, starts_at)
  where status in ('proposed','acknowledged');

create trigger trainer_shifts_touch before update on trainer_shifts
  for each row execute function touch_updated_at();

-- A trainer cannot hold two overlapping shifts.
alter table trainer_shifts
  add constraint trainer_shifts_no_overlap
  exclude using gist (
    trainer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'canceled');

comment on table trainer_shifts is
  'A contiguous block of work. Once confirmed the trainer attends and is paid for the scheduled hours regardless of per-session attendance or later cancellations.';

-- Sessions belong to a shift. Nullable because a session is created before its
-- block is assembled.
alter table sessions
  add column shift_id uuid references trainer_shifts (id) on delete set null;

create index sessions_shift_idx on sessions (shift_id);

-- =============================================================================
-- Private slots
-- =============================================================================
-- Unlike group sessions, private slots are candidates — offered, then booked,
-- then only confirmed once their block becomes viable. The 'block_pending'
-- state is the honest middle: the family has paid, and we are telling them the
-- time is theirs subject to one more booking or an admin decision.

create table private_slots (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    uuid not null references trainers (id) on delete cascade,
  location_id   uuid references locations (id),
  shift_id      uuid references trainer_shifts (id) on delete set null,

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,

  status        private_slot_status not null default 'available',

  price_cents   integer not null default 0 check (price_cents >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (ends_at > starts_at)
);

create index private_slots_trainer_idx on private_slots (trainer_id, starts_at);
create index private_slots_open_idx on private_slots (starts_at)
  where status in ('available','block_pending');

create trigger private_slots_touch before update on private_slots
  for each row execute function touch_updated_at();

alter table private_slots
  add constraint private_slots_no_overlap
  exclude using gist (
    trainer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'canceled');

comment on column private_slots.status is
  'block_pending means paid but not yet viable as a trip. The family is told honestly; a second booking or an admin override moves it to confirmed.';

-- =============================================================================
-- Does this slot join something?
-- =============================================================================
-- The core predicate. A candidate slot is offerable when it touches a confirmed
-- group session, an existing confirmed shift, or another private slot that is
-- already booked — with a travel buffer when the location differs.

create or replace function slot_adjoins_work(
  p_trainer_id  uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_location_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gap_same  integer := setting_int('block_gap_minutes', 0);
  v_gap_travel integer := setting_int('travel_buffer_minutes', 30);
begin
  -- Adjacent to a confirmed group session at the same field?
  if exists (
    select 1
    from sessions s
    join training_groups g on g.id = s.group_id
    where s.trainer_id = p_trainer_id
      and s.status = 'scheduled'
      and g.status in ('confirmed','full')
      and (
        -- immediately after the group, or immediately before it
        (p_starts_at >= s.ends_at   and p_starts_at <= s.ends_at   + make_interval(mins =>
            case when s.location_id is distinct from p_location_id then v_gap_travel else v_gap_same + 30 end))
        or
        (p_ends_at   <= s.starts_at and p_ends_at   >= s.starts_at - make_interval(mins =>
            case when s.location_id is distinct from p_location_id then v_gap_travel else v_gap_same + 30 end))
      )
  ) then
    return true;
  end if;

  -- Adjacent to a shift the trainer has already committed to?
  if exists (
    select 1 from trainer_shifts sh
    where sh.trainer_id = p_trainer_id
      and sh.status in ('acknowledged','confirmed','in_progress')
      and tstzrange(sh.starts_at - make_interval(mins => v_gap_travel),
                    sh.ends_at   + make_interval(mins => v_gap_travel))
          && tstzrange(p_starts_at, p_ends_at)
  ) then
    return true;
  end if;

  -- Adjacent to another private slot that is already spoken for?
  if exists (
    select 1 from private_slots ps
    where ps.trainer_id = p_trainer_id
      and ps.status in ('booked','block_pending','confirmed')
      and (
        (p_starts_at >= ps.ends_at   and p_starts_at <= ps.ends_at   + make_interval(mins =>
            case when ps.location_id is distinct from p_location_id then v_gap_travel else v_gap_same + 30 end))
        or
        (p_ends_at   <= ps.starts_at and p_ends_at   >= ps.starts_at - make_interval(mins =>
            case when ps.location_id is distinct from p_location_id then v_gap_travel else v_gap_same + 30 end))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function slot_adjoins_work is
  'True when a candidate private slot would extend an existing commitment rather than create an isolated trip. Uses a travel buffer when the location differs.';

-- =============================================================================
-- What can a parent actually be offered?
-- =============================================================================
-- Weekday privates may sit beside a group. Weekend privates are the harder
-- case: with no group to anchor them, the first booking of the day is offered
-- as block_pending and only becomes a commitment when a second joins it.

create or replace function offerable_private_slots(
  p_trainer_id uuid,
  p_from       date default current_date,
  p_to         date default null
)
returns setof private_slots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to           date := coalesce(p_to, p_from + setting_int('booking_horizon_days', 45));
  v_notice_hours integer := setting_int('min_notice_hours', 12);
begin
  return query
  select ps.*
  from private_slots ps
  where ps.trainer_id = p_trainer_id
    and ps.status = 'available'
    and ps.starts_at >= now() + make_interval(hours => v_notice_hours)
    and ps.starts_at::date between p_from and v_to
    and (
      -- Either it joins existing work …
      slot_adjoins_work(ps.trainer_id, ps.starts_at, ps.ends_at, ps.location_id)
      -- … or it is a seed slot: the first of a potential weekend block, which
      -- we are willing to offer as block_pending because a second booking can
      -- still make it viable.
      or setting_bool('allow_seed_private_slots', true)
    )
  order by ps.starts_at;
end;
$$;

comment on function offerable_private_slots is
  'What a parent may see. A slot that joins existing work is offered outright; a seed slot is offered knowing it will sit in block_pending until a second booking arrives.';

-- =============================================================================
-- Assembling and confirming a block
-- =============================================================================

create or replace function evaluate_trainer_block(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot     private_slots%rowtype;
  v_min      integer;
  v_is_wknd  boolean;
  v_adjacent integer;
  v_shift    trainer_shifts%rowtype;
  v_start    timestamptz;
  v_end      timestamptz;
begin
  select * into v_slot from private_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown private slot' using errcode = 'no_data_found';
  end if;

  v_is_wknd := extract(dow from v_slot.starts_at) in (0, 6);
  v_min := case when v_is_wknd then setting_int('weekend_min_block_sessions', 2) else 1 end;

  -- A group anchor removes the minimum: the trainer is travelling anyway.
  if slot_adjoins_work(v_slot.trainer_id, v_slot.starts_at, v_slot.ends_at, v_slot.location_id) then
    v_min := 1;
  end if;

  -- Count the paid sessions that would sit in this block, this slot included.
  select count(*)::integer into v_adjacent
  from private_slots ps
  where ps.trainer_id = v_slot.trainer_id
    and ps.status in ('booked','block_pending','confirmed')
    and ps.starts_at::date = v_slot.starts_at::date;

  if v_adjacent < v_min then
    update private_slots set status = 'block_pending' where id = p_slot_id;

    return jsonb_build_object(
      'confirmed', false,
      'reason', 'awaiting_second_booking',
      'sessions_in_block', v_adjacent,
      'sessions_required', v_min
    );
  end if;

  -- Viable. Build or extend the shift spanning the day's slots.
  select min(starts_at), max(ends_at) into v_start, v_end
  from private_slots
  where trainer_id = v_slot.trainer_id
    and status in ('booked','block_pending','confirmed')
    and starts_at::date = v_slot.starts_at::date;

  select * into v_shift
  from trainer_shifts
  where trainer_id = v_slot.trainer_id
    and starts_at::date = v_slot.starts_at::date
    and status <> 'canceled'
  limit 1;

  if found then
    update trainer_shifts
    set starts_at = least(starts_at, v_start),
        ends_at   = greatest(ends_at, v_end),
        status    = case when status = 'proposed' then 'confirmed' else status end,
        confirmed_at = coalesce(confirmed_at, now())
    where id = v_shift.id;
  else
    insert into trainer_shifts (trainer_id, location_id, starts_at, ends_at, status, confirmed_at, hourly_pay_cents)
    select v_slot.trainer_id, v_slot.location_id, v_start, v_end, 'confirmed', now(), t.hourly_pay_cents
    from trainers t where t.id = v_slot.trainer_id
    returning * into v_shift;
  end if;

  update private_slots
  set status = 'confirmed', shift_id = v_shift.id
  where trainer_id = v_slot.trainer_id
    and starts_at::date = v_slot.starts_at::date
    and status in ('booked','block_pending');

  perform write_audit('system', null, 'block.confirmed', 'trainer_shifts', v_shift.id,
                      null, jsonb_build_object('sessions', v_adjacent, 'trainer_id', v_slot.trainer_id));

  return jsonb_build_object('confirmed', true, 'shift_id', v_shift.id, 'sessions_in_block', v_adjacent);
end;
$$;

comment on function evaluate_trainer_block is
  'Decides whether a booked private slot makes its block viable. Weekends need two consecutive paid sessions unless a group anchors the day or an admin overrides.';

-- =============================================================================
-- Rule 4: a confirmed block survives a cancellation
-- =============================================================================
-- Once a trainer is committed, the remaining family keeps their session and the
-- trainer keeps their pay. Family B is not punished for family A cancelling.

create or replace function handle_block_cancellation(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot      private_slots%rowtype;
  v_shift     trainer_shifts%rowtype;
  v_remaining integer;
begin
  select * into v_slot from private_slots where id = p_slot_id;
  if not found or v_slot.shift_id is null then
    return jsonb_build_object('shift_kept', false, 'reason', 'no_shift');
  end if;

  select * into v_shift from trainer_shifts where id = v_slot.shift_id for update;

  select count(*)::integer into v_remaining
  from private_slots
  where shift_id = v_shift.id and status in ('booked','block_pending','confirmed');

  if v_remaining = 0 then
    -- Nothing left. Release the trainer.
    update trainer_shifts set status = 'canceled' where id = v_shift.id;

    perform write_audit('system', null, 'block.released', 'trainer_shifts', v_shift.id,
                        null, jsonb_build_object('reason', 'all_sessions_canceled'));

    return jsonb_build_object('shift_kept', false, 'remaining', 0);
  end if;

  -- One or more remain. The commitment stands, whatever the count.
  perform write_audit('system', null, 'block.honoured_below_minimum', 'trainer_shifts', v_shift.id,
                      null, jsonb_build_object('remaining', v_remaining,
                        'note', 'Confirmed block kept despite falling below the block minimum'));

  return jsonb_build_object('shift_kept', true, 'remaining', v_remaining,
                            'trainer_still_paid', true);
end;
$$;

comment on function handle_block_cancellation is
  'Rule 4. A confirmed block is never dissolved because one family cancelled — the remaining booking is honoured and the trainer is still paid.';

-- =============================================================================
-- Admin override
-- =============================================================================

create or replace function override_confirm_block(
  p_shift_id uuid,
  p_reason   text
)
returns trainer_shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift trainer_shifts%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'An override needs a reason' using errcode = 'check_violation';
  end if;

  update trainer_shifts
  set status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      override_by = auth.uid(),
      override_reason = p_reason
  where id = p_shift_id
  returning * into v_shift;

  update private_slots set status = 'confirmed'
  where shift_id = p_shift_id and status in ('booked','block_pending');

  perform write_audit('admin', auth.uid(), 'block.override_confirmed', 'trainer_shifts', p_shift_id,
                      null, jsonb_build_object('reason', p_reason));

  return v_shift;
end;
$$;

-- =============================================================================
-- Trainer hours and expected pay
-- =============================================================================
-- Paid on scheduled hours, not attendance.

create table trainer_hours (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    uuid not null references trainers (id) on delete cascade,
  shift_id      uuid references trainer_shifts (id) on delete set null,

  worked_on     date not null,
  minutes       integer not null check (minutes > 0),
  hourly_rate_cents integer not null check (hourly_rate_cents >= 0),
  amount_cents  integer not null check (amount_cents >= 0),

  status        text not null default 'pending'
                  check (status in ('pending','approved','paid','disputed')),

  stripe_transfer_id text unique,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),

  unique (shift_id)
);

create index trainer_hours_trainer_idx on trainer_hours (trainer_id, worked_on desc);
create index trainer_hours_unpaid_idx on trainer_hours (status) where status in ('pending','approved');

comment on table trainer_hours is
  'One row per completed shift. Pay is scheduled minutes times the trainer''s hourly rate — attendance does not reduce it.';

create or replace function record_trainer_hours(p_shift_id uuid)
returns trainer_hours
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift trainer_shifts%rowtype;
  v_mins  integer;
  v_row   trainer_hours%rowtype;
begin
  select * into v_shift from trainer_shifts where id = p_shift_id;
  if not found then
    raise exception 'Unknown shift' using errcode = 'no_data_found';
  end if;

  v_mins := ceil(extract(epoch from (v_shift.ends_at - v_shift.starts_at)) / 60.0)::integer;

  -- Unique on shift_id makes this idempotent: completing twice pays once.
  insert into trainer_hours (trainer_id, shift_id, worked_on, minutes, hourly_rate_cents, amount_cents)
  values (
    v_shift.trainer_id,
    p_shift_id,
    v_shift.starts_at::date,
    v_mins,
    v_shift.hourly_pay_cents,
    round(v_shift.hourly_pay_cents * v_mins / 60.0)::integer
  )
  on conflict (shift_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from trainer_hours where shift_id = p_shift_id;
  end if;

  return v_row;
end;
$$;
