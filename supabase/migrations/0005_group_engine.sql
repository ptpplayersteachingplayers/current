-- =============================================================================
-- 0005 — The group engine
-- =============================================================================
-- Capacity, activation, holds, credits and waitlist promotion.
--
-- Everything here is a database function rather than application code, for one
-- reason: these rules decide whether money is taken and whether a trainer is
-- committed. Two parents can tap "book" in the same second, and the only place
-- that race can be settled correctly is inside the transaction that writes the
-- row.
-- =============================================================================

-- =============================================================================
-- Eligibility
-- =============================================================================

create or replace function player_is_eligible(p_player_id uuid, p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_player  players%rowtype;
  v_group   training_groups%rowtype;
  v_season  seasons%rowtype;
  v_age     integer;
begin
  select * into v_player from players where id = p_player_id;
  if not found then return false; end if;

  select * into v_group from training_groups where id = p_group_id;
  if not found then return false; end if;

  select * into v_season from seasons where id = v_group.season_id;

  -- Skill band is always checked.
  if v_player.skill_level < v_group.min_skill or v_player.skill_level > v_group.max_skill then
    return false;
  end if;

  -- Age is evaluated on the season start, so a birthday mid-season does not
  -- push a player out of the group they are already training with.
  v_age := player_age_on(v_player.birth_date, v_season.starts_on);

  if v_age is null then
    -- No birth date on file. Eligible, but the admin screen flags it — better
    -- to let a family book and follow up than to silently hide every group.
    return true;
  end if;

  if v_group.min_age is not null and v_age < v_group.min_age then return false; end if;
  if v_group.max_age is not null and v_age > v_group.max_age then return false; end if;

  return true;
end;
$$;

comment on function player_is_eligible is
  'Age and skill gate for a group. Age is measured on the season start date. Admins can override by enrolling directly — this function is advisory to parents, authoritative in the booking path.';

-- =============================================================================
-- Capacity
-- =============================================================================
-- Occupancy is paid enrollments plus live holds. A hold counts, otherwise two
-- families can pay for the same last spot within the hold window.

create or replace function group_occupancy(p_group_id uuid)
returns table (paid integer, held integer, total integer, capacity integer)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select max_players from training_groups where id = p_group_id
  ),
  p as (
    select count(*)::integer as n
    from enrollments e
    where e.group_id = p_group_id and e.state = 'active' and e.is_paid
  ),
  h as (
    -- Holds are against sessions; a hold on any session of this group occupies
    -- a place while it lives.
    select count(distinct bh.player_id)::integer as n
    from booking_holds bh
    join sessions s on s.id = bh.session_id
    where s.group_id = p_group_id
      and bh.expires_at > now()
      -- Do not double-count someone already enrolled and paid.
      and not exists (
        select 1 from enrollments e
        where e.group_id = p_group_id and e.player_id = bh.player_id
          and e.state = 'active' and e.is_paid
      )
  )
  select p.n, h.n, p.n + h.n, g.max_players from g, p, h;
$$;

-- Group occupancy answers "is there a place in this group for the season?".
-- It is not the same question as "is there room on the field on Thursday?" — a
-- group of four enrolled players with two drop-ins is six bodies. Sessions get
-- their own count, and both are checked before a hold is issued.
create or replace function session_occupancy(p_session_id uuid)
returns table (taken integer, capacity integer)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select s.id, s.group_id, s.kind from sessions s where s.id = p_session_id
  ),
  booked as (
    select count(distinct b.player_id)::integer as n
    from bookings b, s
    where b.session_id = s.id and b.status not in ('canceled','refunded')
  ),
  held as (
    select count(distinct bh.player_id)::integer as n
    from booking_holds bh, s
    where bh.session_id = s.id
      and bh.expires_at > now()
      and not exists (
        select 1 from bookings b
        where b.session_id = s.id and b.player_id = bh.player_id
          and b.status not in ('canceled','refunded')
      )
  )
  select booked.n + held.n,
         case when s.kind = 'private' then 1
              else coalesce((select g.max_players from training_groups g where g.id = s.group_id), 1)
         end
  from s, booked, held;
$$;

create or replace function session_has_space(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select taken < capacity from session_occupancy(p_session_id)), false);
$$;

create or replace function group_has_space(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select total < capacity from group_occupancy(p_group_id);
$$;

-- =============================================================================
-- Status transitions
-- =============================================================================
-- One function owns the Forming / Confirmed / Full ladder, called after any
-- change to paid enrollment. Nothing else writes training_groups.status except
-- an admin cancelling or completing.

create or replace function recompute_group_status(p_group_id uuid)
returns group_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group  training_groups%rowtype;
  v_paid   integer;
  v_new    group_status;
begin
  select * into v_group from training_groups where id = p_group_id for update;
  if not found then return null; end if;

  -- Terminal states are never recomputed. A completed season does not reopen
  -- because someone's refund changed a count.
  if v_group.status in ('draft','completed','canceled') then
    return v_group.status;
  end if;

  select paid into v_paid from group_occupancy(p_group_id);

  if v_paid >= v_group.max_players then
    v_new := 'full';
  elsif v_paid >= v_group.min_players then
    v_new := 'confirmed';
  else
    v_new := 'forming';
  end if;

  if v_new is distinct from v_group.status then
    update training_groups set status = v_new where id = p_group_id;

    perform write_audit('system', null, 'group.status_changed', 'training_groups', p_group_id,
      jsonb_build_object('status', v_group.status),
      jsonb_build_object('status', v_new, 'paid_players', v_paid));

    -- Crossing into confirmed is the moment the trainer is committed and the
    -- families can be told it is running. Downstream jobs listen for this.
    if v_new = 'confirmed' and v_group.status = 'forming' then
      perform write_audit('system', null, 'group.activated', 'training_groups', p_group_id,
                          null, jsonb_build_object('paid_players', v_paid));
    end if;
  end if;

  return v_new;
end;
$$;

comment on function recompute_group_status is
  'The Forming/Confirmed/Full ladder. Called after any paid-enrollment change. Once confirmed, the trainer attends and is paid regardless of per-session attendance.';

-- Keep session.paid_count and group status true whenever enrollment moves.
create or replace function enrollments_after_change()
returns trigger
language plpgsql
as $$
begin
  perform recompute_group_status(coalesce(new.group_id, old.group_id));
  return null;
end;
$$;

create trigger enrollments_recompute
  after insert or update or delete on enrollments
  for each row execute function enrollments_after_change();

-- sessions.paid_count is how many people are actually expected on the field,
-- which is a booking count — enrolled families and drop-ins alike. The roster
-- screen and the trainer's phone read this, so it must mean attendance, not
-- commitment.
create or replace function bookings_after_change()
returns trigger
language plpgsql
as $$
declare
  v_session uuid;
begin
  v_session := coalesce(new.session_id, old.session_id);

  update sessions s
  set paid_count = (
    select count(distinct b.player_id) from bookings b
    where b.session_id = v_session and b.status not in ('canceled','refunded')
  )
  where s.id = v_session;

  return null;
end;
$$;

create trigger bookings_recount
  after insert or update or delete on bookings
  for each row execute function bookings_after_change();

-- =============================================================================
-- Holds
-- =============================================================================

create or replace function create_booking_hold(
  p_session_id uuid,
  p_player_id  uuid,
  p_use_credit boolean default false
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   sessions%rowtype;
  v_player    players%rowtype;
  v_hold      booking_holds%rowtype;
  v_minutes   integer;
  v_credit    package_credits%rowtype;
begin
  select * into v_session from sessions where id = p_session_id;
  if not found then
    raise exception 'Unknown session' using errcode = 'no_data_found';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'That session is not open for booking' using errcode = 'check_violation';
  end if;

  if v_session.starts_at <= now() then
    raise exception 'That session has already started' using errcode = 'check_violation';
  end if;

  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  -- Lock the group row so two concurrent holds cannot both see the last spot.
  if v_session.group_id is not null then
    perform 1 from training_groups where id = v_session.group_id for update;

    if not player_is_eligible(p_player_id, v_session.group_id) then
      raise exception 'That player is not eligible for this group' using errcode = 'check_violation';
    end if;

    if not group_has_space(v_session.group_id) then
      raise exception 'That group is full' using errcode = 'check_violation';
    end if;
  end if;

  -- And there has to be room on the field that day. This is the check that
  -- stops drop-ins overfilling a session the enrolled families already fill.
  if not session_has_space(p_session_id) then
    raise exception 'That session is full' using errcode = 'check_violation';
  end if;

  v_minutes := setting_int('hold_minutes', 15);

  -- Reserve a credit if asked, so it cannot be spent twice across two tabs.
  if p_use_credit then
    select * into v_credit
    from package_credits
    where household_id = v_player.household_id
      and state = 'available'
      and expires_on >= current_date
    order by expires_on asc
    limit 1
    for update skip locked;

    if not found then
      raise exception 'No package credits available' using errcode = 'check_violation';
    end if;

    update package_credits
    set state = 'reserved', reserved_until = now() + make_interval(mins => v_minutes)
    where id = v_credit.id;
  end if;

  insert into booking_holds (session_id, player_id, household_id, expires_at, credit_id)
  values (
    p_session_id,
    p_player_id,
    v_player.household_id,
    now() + make_interval(mins => v_minutes),
    v_credit.id
  )
  on conflict (session_id, player_id) do update
    set expires_at = excluded.expires_at
  returning * into v_hold;

  perform write_audit('parent', auth.uid(), 'hold.created', 'booking_holds', v_hold.id,
                      null, jsonb_build_object('session_id', p_session_id, 'player_id', p_player_id));

  return v_hold;
end;
$$;

comment on function create_booking_hold is
  'Fifteen-minute reservation. Locks the group row so two families cannot both take the last spot, and reserves a credit so it cannot be spent twice.';

-- Release everything a lapsed hold was holding. Run by the five-minute job.
create or replace function expire_booking_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_hold  booking_holds%rowtype;
begin
  for v_hold in
    select * from booking_holds where expires_at <= now() for update skip locked
  loop
    -- Give the credit back before dropping the hold, so a crash between the
    -- two leaves a reserved credit (recoverable) rather than a lost one.
    if v_hold.credit_id is not null then
      update package_credits
      set state = 'available', reserved_until = null
      where id = v_hold.credit_id and state = 'reserved';
    end if;

    delete from booking_holds where id = v_hold.id;

    perform write_audit('system', null, 'hold.expired', 'booking_holds', v_hold.id,
                        jsonb_build_object('session_id', v_hold.session_id), null);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- Confirming a booking
-- =============================================================================
-- The only path to 'confirmed'. Called from the Stripe webhook after payment,
-- or directly when a credit is spent. No client can call this with an amount.

create or replace function confirm_booking(
  p_session_id uuid,
  p_player_id  uuid,
  p_payment_id uuid default null,
  p_credit_id  uuid default null,
  p_price_cents integer default 0,
  p_enroll     boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session sessions%rowtype;
  v_player  players%rowtype;
  v_booking bookings%rowtype;
begin
  if p_payment_id is null and p_credit_id is null then
    raise exception 'A booking must be paid for by a payment or a credit'
      using errcode = 'check_violation';
  end if;

  select * into v_session from sessions where id = p_session_id;
  select * into v_player  from players  where id = p_player_id;

  -- Idempotent: a retried webhook returns the existing booking rather than
  -- creating a second one or raising.
  select * into v_booking
  from bookings
  where session_id = p_session_id and player_id = p_player_id
    and status not in ('canceled','refunded');

  if found then
    return v_booking;
  end if;

  insert into bookings (session_id, player_id, household_id, status, payment_id, credit_id, price_cents)
  values (p_session_id, p_player_id, v_player.household_id, 'confirmed', p_payment_id, p_credit_id, p_price_cents)
  returning * into v_booking;

  -- Spend the credit.
  if p_credit_id is not null then
    update package_credits
    set state = 'consumed', consumed_at = now(), booking_id = v_booking.id, reserved_until = null
    where id = p_credit_id;
  end if;

  -- Enrolment is a season commitment and is asked for explicitly. A drop-in is
  -- one Thursday, not a promise: four families dropping in on the same evening
  -- must not activate a group and commit a trainer to sixteen sessions.
  if p_enroll and v_session.group_id is not null then
    insert into enrollments (group_id, player_id, household_id, is_paid)
    values (v_session.group_id, p_player_id, v_player.household_id, true)
    on conflict (group_id, player_id) where state = 'active'
    do update set is_paid = true;
  end if;

  -- The hold has done its job.
  delete from booking_holds where session_id = p_session_id and player_id = p_player_id;

  perform write_audit('system', null, 'booking.confirmed', 'bookings', v_booking.id,
                      null, jsonb_build_object('session_id', p_session_id, 'player_id', p_player_id,
                                               'price_cents', p_price_cents));

  return v_booking;
end;
$$;

comment on function confirm_booking is
  'The only path into confirmed. Idempotent on (session, player) so a replayed Stripe webhook cannot create a second booking. Enrolls for the season only when asked — a drop-in does not count toward activation.';

-- =============================================================================
-- Cancellation and makeup credits
-- =============================================================================

create or replace function cancel_booking(
  p_booking_id uuid,
  p_by_staff   boolean default false,
  p_reason     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_session sessions%rowtype;
  v_hours   numeric;
  v_cutoff  integer;
  v_refund  boolean;
  v_makeup  boolean := false;
  v_credit  uuid;
  v_remaining integer;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Unknown booking' using errcode = 'no_data_found';
  end if;

  if v_booking.status in ('canceled','refunded') then
    raise exception 'That booking is already cancelled' using errcode = 'check_violation';
  end if;

  perform assert_household_access(v_booking.household_id);

  select * into v_session from sessions where id = v_booking.session_id;

  v_cutoff := setting_int('free_cancel_hours', 24);
  v_hours  := extract(epoch from (v_session.starts_at - now())) / 3600.0;

  -- Staff always refund. A family cancelling in time is refunded; inside the
  -- window they are not, and the trainer keeps the commitment either way once
  -- the group is confirmed.
  v_refund := p_by_staff or v_hours >= v_cutoff;

  -- Cancelled either way. Whether money goes back is v_refund, decided above
  -- and returned to the caller; the booking's own state does not vary.
  update bookings
  set status = 'canceled',
      canceled_at = now(),
      canceled_by = auth.uid(),
      cancel_reason = p_reason
  where id = p_booking_id;

  -- A credit-paid booking returns the credit when cancelled in time; late, it
  -- becomes a makeup credit only if policy allows, otherwise it is spent.
  if v_booking.credit_id is not null then
    if v_refund then
      update package_credits
      set state = 'available', booking_id = null, consumed_at = null
      where id = v_booking.credit_id;
    elsif setting_bool('late_cancel_issues_makeup', false) then
      update package_credits set state = 'consumed' where id = v_booking.credit_id;
      v_credit := issue_makeup_credit(v_booking.household_id, v_session.season_id, 'late cancellation');
      v_makeup := true;
    end if;
  end if;

  -- Leaving one session is not leaving the group. A family who bought the
  -- sixteen-session package and cancels week three is still enrolled — and
  -- still counts toward activation, which matters to the other five families.
  -- The enrollment ends only when nothing of theirs is left in the group.
  if v_session.group_id is not null then
    select count(*) into v_remaining
    from bookings b
    join sessions s on s.id = b.session_id
    where s.group_id = v_session.group_id
      and b.player_id = v_booking.player_id
      and b.status not in ('canceled','refunded');

    if v_remaining = 0 then
      update enrollments
      set state = 'withdrawn', withdrawn_at = now()
      where group_id = v_session.group_id and player_id = v_booking.player_id and state = 'active';
    end if;
  end if;

  perform write_audit(
    (case when p_by_staff then 'admin' else 'parent' end)::actor_kind,
    auth.uid(), 'booking.canceled', 'bookings', p_booking_id,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('refund_due', v_refund, 'makeup_issued', v_makeup, 'reason', p_reason));

  return jsonb_build_object(
    'refund_due', v_refund,
    'makeup_issued', v_makeup,
    'makeup_credit_id', v_credit,
    'left_group', v_session.group_id is not null and coalesce(v_remaining, 0) = 0,
    'hours_notice', round(v_hours, 1)
  );
end;
$$;

comment on function cancel_booking is
  'Applies the cancellation policy and frees the place. Returns whether a refund is due; the Stripe call itself is made by the edge function, which then records the refund row.';

create or replace function issue_makeup_credit(
  p_household_id uuid,
  p_season_id    uuid,
  p_note         text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires date;
  v_id uuid;
begin
  select credits_expire_on into v_expires from seasons where id = p_season_id;

  insert into package_credits (package_id, household_id, expires_on, origin, origin_note, state)
  select null, p_household_id, coalesce(v_expires, current_date + 60), 'makeup', p_note, 'available'
  returning id into v_id;

  perform write_audit('admin', auth.uid(), 'credit.makeup_issued', 'package_credits', v_id,
                      null, jsonb_build_object('household_id', p_household_id, 'note', p_note));

  return v_id;
end;
$$;

-- package_id is nullable for makeup credits, which are issued rather than bought.
alter table package_credits alter column package_id drop not null;

-- =============================================================================
-- Credit expiry
-- =============================================================================

create or replace function expire_package_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update package_credits
    set state = 'expired', expired_at = now()
    where state = 'available' and expires_on < current_date
    returning id, household_id
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$$;

-- =============================================================================
-- Waitlist promotion
-- =============================================================================

create or replace function promote_waitlist(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next   waitlists%rowtype;
  v_hours  integer;
begin
  if not group_has_space(p_group_id) then
    return null;
  end if;

  -- Skip anyone already invited and still inside their window.
  select * into v_next
  from waitlists
  where group_id = p_group_id and state = 'waiting'
  order by position asc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  v_hours := setting_int('waitlist_invite_hours', 24);

  update waitlists
  set state = 'invited',
      invited_at = now(),
      invite_expires_at = now() + make_interval(hours => v_hours)
  where id = v_next.id;

  perform write_audit('system', null, 'waitlist.invited', 'waitlists', v_next.id,
                      null, jsonb_build_object('group_id', p_group_id, 'player_id', v_next.player_id));

  return v_next.id;
end;
$$;

-- Expire stale invitations and pass the spot along. Run hourly.
create or replace function lapse_waitlist_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row waitlists%rowtype;
  v_n integer := 0;
begin
  for v_row in
    select * from waitlists
    where state = 'invited' and invite_expires_at <= now()
    for update skip locked
  loop
    update waitlists set state = 'expired' where id = v_row.id;
    perform promote_waitlist(v_row.group_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;
