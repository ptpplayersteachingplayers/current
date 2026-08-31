-- =============================================================================
-- 0022 — Running the training side without SQL
-- =============================================================================
-- Every group, season, location and trainer in this database arrived from a
-- seed file. There was no way for an administrator to create one, which made
-- the read-only admin console a report about a system only its author could
-- operate. This file is the write half.
--
-- Three rules, none of them new — they are the same ones the booking path
-- already holds, applied to the side that creates the things being booked.
--
--   1. Staff is asserted in the body, never by hiding a button. Each function
--      here is granted to `authenticated`, because an administrator is an
--      authenticated user; assert_staff() is therefore the only thing between
--      a parent and a price.
--
--   2. Verification stays a separate act. verify_location() is not a field on
--      the location form. Confirming a field is real, free and ours to use is
--      what lets a group open and commit six families to a gate, so it is its
--      own decision with its own audit line.
--
--   3. A schedule change never silently destroys a booking. Meeting times can
--      be rewritten while a group is forming; once a future session has
--      someone in it, the change is refused and says which session.
-- =============================================================================

-- generate_group_sessions() was service-only, which is correct for a cron job
-- and wrong for the administrator publishing a group: through PostgREST they
-- arrive as `authenticated`, not as the service role. assert_staff() accepts
-- both, so the job keeps working and a person can now do it too.
create or replace function generate_group_sessions(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   training_groups%rowtype;
  v_season  seasons%rowtype;
  v_meeting group_meeting_times%rowtype;
  v_tz      text := setting_text('display_timezone', 'America/New_York');
  v_date    date;
  v_created integer := 0;
  v_rows    integer;
begin
  perform assert_staff();

  select * into v_group from training_groups where id = p_group_id;
  if not found then
    raise exception 'Unknown group' using errcode = 'no_data_found';
  end if;

  select * into v_season from seasons where id = v_group.season_id;

  for v_meeting in
    select * from group_meeting_times where group_id = p_group_id order by weekday, starts_time
  loop
    v_date := v_season.starts_on;

    while extract(dow from v_date) <> v_meeting.weekday loop
      v_date := v_date + 1;
    end loop;

    while v_date <= v_season.ends_on loop
      insert into sessions (kind, group_id, season_id, trainer_id, location_id, starts_at, ends_at)
      values (
        'group', p_group_id, v_group.season_id, v_group.trainer_id, v_group.location_id,
        ((v_date + v_meeting.starts_time) at time zone v_tz),
        ((v_date + v_meeting.starts_time) at time zone v_tz)
          + make_interval(mins => v_meeting.duration_minutes)
      )
      on conflict do nothing;

      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;

      v_date := v_date + 7;
    end loop;
  end loop;

  return v_created;
end;
$$;

-- =============================================================================
-- Places
-- =============================================================================

create or replace function upsert_location(p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := nullif(p_details ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p_details ->> 'name', ''));
begin
  perform assert_staff();

  if v_name = '' then
    raise exception 'A location needs a name' using errcode = 'check_violation';
  end if;

  if v_id is null then
    insert into locations (
      name, address_line, city, state, postal_code, latitude, longitude,
      surface, is_indoor, has_lighting, permit_status, usage_cost_cents,
      contact_name, contact_phone, parking_notes, meeting_instructions,
      weather_limitations, active)
    values (
      v_name,
      coalesce(p_details ->> 'address_line', ''),
      coalesce(p_details ->> 'city', ''),
      coalesce(p_details ->> 'state', ''),
      coalesce(p_details ->> 'postal_code', ''),
      nullif(p_details ->> 'latitude', '')::numeric,
      nullif(p_details ->> 'longitude', '')::numeric,
      coalesce(p_details ->> 'surface', 'grass'),
      coalesce((p_details ->> 'is_indoor')::boolean, false),
      coalesce((p_details ->> 'has_lighting')::boolean, false),
      coalesce(p_details ->> 'permit_status', 'unknown'),
      coalesce((p_details ->> 'usage_cost_cents')::integer, 0),
      coalesce(p_details ->> 'contact_name', ''),
      coalesce(p_details ->> 'contact_phone', ''),
      coalesce(p_details ->> 'parking_notes', ''),
      coalesce(p_details ->> 'meeting_instructions', ''),
      coalesce(p_details ->> 'weather_limitations', ''),
      coalesce((p_details ->> 'active')::boolean, true))
    returning id into v_id;

    perform write_audit('admin'::actor_kind, auth.uid(), 'location.created', 'locations', v_id, p_details);
    return v_id;
  end if;

  -- An update never touches verified_at. Editing the parking notes is not a
  -- re-verification, and re-verifying is not an edit.
  update locations set
    name                 = v_name,
    address_line         = coalesce(p_details ->> 'address_line', address_line),
    city                 = coalesce(p_details ->> 'city', city),
    state                = coalesce(p_details ->> 'state', state),
    postal_code          = coalesce(p_details ->> 'postal_code', postal_code),
    latitude             = coalesce(nullif(p_details ->> 'latitude', '')::numeric, latitude),
    longitude            = coalesce(nullif(p_details ->> 'longitude', '')::numeric, longitude),
    surface              = coalesce(p_details ->> 'surface', surface),
    is_indoor            = coalesce((p_details ->> 'is_indoor')::boolean, is_indoor),
    has_lighting         = coalesce((p_details ->> 'has_lighting')::boolean, has_lighting),
    permit_status        = coalesce(p_details ->> 'permit_status', permit_status),
    usage_cost_cents     = coalesce((p_details ->> 'usage_cost_cents')::integer, usage_cost_cents),
    contact_name         = coalesce(p_details ->> 'contact_name', contact_name),
    contact_phone        = coalesce(p_details ->> 'contact_phone', contact_phone),
    parking_notes        = coalesce(p_details ->> 'parking_notes', parking_notes),
    meeting_instructions = coalesce(p_details ->> 'meeting_instructions', meeting_instructions),
    weather_limitations  = coalesce(p_details ->> 'weather_limitations', weather_limitations),
    active               = coalesce((p_details ->> 'active')::boolean, active),
    updated_at           = now()
  where id = v_id;

  if not found then
    raise exception 'Unknown location' using errcode = 'no_data_found';
  end if;

  perform write_audit('admin'::actor_kind, auth.uid(), 'location.updated', 'locations', v_id, p_details);
  return v_id;
end;
$$;

comment on function upsert_location is
  'Creates or edits a field. Never sets verified_at — see verify_location(), which is a separate decision on purpose.';

create or replace function verify_location(p_location_id uuid, p_verified boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permit text;
  v_open   integer;
begin
  perform assert_staff();

  select permit_status into v_permit from locations where id = p_location_id;
  if not found then
    raise exception 'Unknown location' using errcode = 'no_data_found';
  end if;

  if p_verified and v_permit not in ('permitted', 'reserved') then
    raise exception 'A field cannot be verified while its permit status is %', v_permit
      using errcode = 'check_violation';
  end if;

  -- Withdrawing verification under a group that is already running would leave
  -- families booked onto a field we have just said we cannot use. Say so
  -- rather than doing it quietly.
  if not p_verified then
    select count(*) into v_open
    from training_groups
    where location_id = p_location_id and status <> 'draft';

    if v_open > 0 then
      raise exception 'Cannot unverify: % group(s) are open on this field. Move or cancel them first', v_open
        using errcode = 'check_violation';
    end if;
  end if;

  update locations
  set verified_at = case when p_verified then now() else null end,
      verified_by = case when p_verified then auth.uid() else null end,
      updated_at  = now()
  where id = p_location_id;

  perform write_audit('admin'::actor_kind, auth.uid(),
                      case when p_verified then 'location.verified' else 'location.unverified' end,
                      'locations', p_location_id, jsonb_build_object('verified', p_verified));

  return p_verified;
end;
$$;

comment on function verify_location is
  'Confirming a field is real, free and ours to use. This is what lets a group open, so it carries its own audit line and refuses to be withdrawn under a live group.';

-- =============================================================================
-- Seasons
-- =============================================================================

create or replace function upsert_season(p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := nullif(p_details ->> 'id', '')::uuid;
  v_starts  date := (p_details ->> 'starts_on')::date;
  v_ends    date := (p_details ->> 'ends_on')::date;
  v_expires date := nullif(p_details ->> 'credits_expire_on', '')::date;
begin
  perform assert_staff();

  if v_id is null then
    if v_starts is null or v_ends is null then
      raise exception 'A season needs a start and an end' using errcode = 'check_violation';
    end if;

    -- Credits expire at the end of the season unless someone says otherwise.
    insert into seasons (name, starts_on, ends_on, weeks, credits_expire_on, status)
    values (
      coalesce(nullif(p_details ->> 'name', ''), to_char(v_starts, 'FMMonth YYYY')),
      v_starts, v_ends,
      coalesce((p_details ->> 'weeks')::smallint,
               greatest(1, ((v_ends - v_starts) / 7))::smallint),
      coalesce(v_expires, v_ends),
      coalesce(p_details ->> 'status', 'planned'))
    returning id into v_id;

    perform write_audit('admin'::actor_kind, auth.uid(), 'season.created', 'seasons', v_id, p_details);
    return v_id;
  end if;

  update seasons set
    name              = coalesce(nullif(p_details ->> 'name', ''), name),
    starts_on         = coalesce(v_starts, starts_on),
    ends_on           = coalesce(v_ends, ends_on),
    weeks             = coalesce((p_details ->> 'weeks')::smallint, weeks),
    credits_expire_on = coalesce(v_expires, credits_expire_on),
    status            = coalesce(p_details ->> 'status', status),
    updated_at        = now()
  where id = v_id;

  if not found then
    raise exception 'Unknown season' using errcode = 'no_data_found';
  end if;

  perform write_audit('admin'::actor_kind, auth.uid(), 'season.updated', 'seasons', v_id, p_details);
  return v_id;
end;
$$;

-- =============================================================================
-- Groups
-- =============================================================================

create or replace function upsert_training_group(p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := nullif(p_details ->> 'id', '')::uuid;
  v_season uuid := nullif(p_details ->> 'season_id', '')::uuid;
  v_name   text := trim(coalesce(p_details ->> 'name', ''));
  v_slug   text := nullif(p_details ->> 'slug', '');
begin
  perform assert_staff();

  if v_id is null then
    if v_season is null then
      raise exception 'A group belongs to a season' using errcode = 'check_violation';
    end if;
    if v_name = '' then
      raise exception 'A group needs a name' using errcode = 'check_violation';
    end if;

    -- A slug the admin did not have to think about, derived from the name and
    -- unique within its season by the table's own constraint.
    v_slug := coalesce(v_slug, regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);

    insert into training_groups (
      season_id, name, slug, min_age, max_age, min_skill, max_skill,
      location_id, trainer_id, min_players, target_players, max_players,
      dropin_price_cents)
    values (
      v_season, v_name, v_slug,
      nullif(p_details ->> 'min_age', '')::smallint,
      nullif(p_details ->> 'max_age', '')::smallint,
      coalesce((p_details ->> 'min_skill')::smallint, 1),
      coalesce((p_details ->> 'max_skill')::smallint, 5),
      nullif(p_details ->> 'location_id', '')::uuid,
      nullif(p_details ->> 'trainer_id', '')::uuid,
      coalesce((p_details ->> 'min_players')::smallint, 4),
      coalesce((p_details ->> 'target_players')::smallint, 5),
      coalesce((p_details ->> 'max_players')::smallint, 6),
      nullif(p_details ->> 'dropin_price_cents', '')::integer)
    returning id into v_id;

    perform write_audit('admin'::actor_kind, auth.uid(), 'group.created', 'training_groups', v_id, p_details);
    return v_id;
  end if;

  -- Status is not editable here. Opening a group runs a guard; closing one has
  -- consequences for the families in it. Both have their own function.
  update training_groups set
    name               = coalesce(nullif(v_name, ''), name),
    slug               = coalesce(v_slug, slug),
    min_age            = coalesce(nullif(p_details ->> 'min_age', '')::smallint, min_age),
    max_age            = coalesce(nullif(p_details ->> 'max_age', '')::smallint, max_age),
    min_skill          = coalesce((p_details ->> 'min_skill')::smallint, min_skill),
    max_skill          = coalesce((p_details ->> 'max_skill')::smallint, max_skill),
    location_id        = coalesce(nullif(p_details ->> 'location_id', '')::uuid, location_id),
    trainer_id         = coalesce(nullif(p_details ->> 'trainer_id', '')::uuid, trainer_id),
    min_players        = coalesce((p_details ->> 'min_players')::smallint, min_players),
    target_players     = coalesce((p_details ->> 'target_players')::smallint, target_players),
    max_players        = coalesce((p_details ->> 'max_players')::smallint, max_players),
    dropin_price_cents = coalesce(nullif(p_details ->> 'dropin_price_cents', '')::integer, dropin_price_cents),
    updated_at         = now()
  where id = v_id;

  if not found then
    raise exception 'Unknown group' using errcode = 'no_data_found';
  end if;

  perform write_audit('admin'::actor_kind, auth.uid(), 'group.updated', 'training_groups', v_id, p_details);
  return v_id;
end;
$$;

comment on function upsert_training_group is
  'Creates or edits a group. Deliberately cannot change status: opening one runs the activation guard, closing one affects the families in it, so both are their own function.';

/*
 * Replace a group's weekly schedule.
 *
 * p_times is an array of {weekday, starts_time, duration_minutes}. It is the
 * whole schedule, not an addition — what is not in the array is removed.
 *
 * Future sessions are rebuilt from it. Sessions that have already happened are
 * history and are left alone. A future session with anyone in it stops the
 * whole thing: moving a session out from under a family who paid for it is not
 * a schedule edit, it is a cancellation, and it should be made deliberately.
 */
create or replace function set_group_meeting_times(p_group_id uuid, p_times jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booked   record;
  v_time     jsonb;
  v_status   group_status;
begin
  perform assert_staff();

  select status into v_status from training_groups where id = p_group_id;
  if not found then
    raise exception 'Unknown group' using errcode = 'no_data_found';
  end if;

  select s.starts_at, count(b.id) as n into v_booked
  from sessions s
  join bookings b on b.session_id = s.id and b.status in ('confirmed', 'held')
  where s.group_id = p_group_id and s.starts_at > now()
  group by s.starts_at
  order by s.starts_at
  limit 1;

  if v_booked.starts_at is not null then
    raise exception 'Cannot change the schedule: % player(s) are booked into the session on %',
      v_booked.n, to_char(v_booked.starts_at at time zone setting_text('display_timezone', 'America/New_York'),
                          'FMDay FMDD FMMonth at FMHH12:MIam')
      using errcode = 'check_violation';
  end if;

  delete from group_meeting_times where group_id = p_group_id;

  for v_time in select * from jsonb_array_elements(p_times)
  loop
    insert into group_meeting_times (group_id, weekday, starts_time, duration_minutes)
    values (
      p_group_id,
      (v_time ->> 'weekday')::smallint,
      (v_time ->> 'starts_time')::time,
      coalesce((v_time ->> 'duration_minutes')::smallint, 60))
    on conflict (group_id, weekday, starts_time) do nothing;
  end loop;

  -- Only the future is rebuilt. Attendance already taken stays taken.
  delete from sessions
  where group_id = p_group_id and starts_at > now() and paid_count = 0;

  perform write_audit('admin'::actor_kind, auth.uid(), 'group.schedule_set',
                      'training_groups', p_group_id, p_times);

  return generate_group_sessions(p_group_id);
end;
$$;

/*
 * Open a group for booking.
 *
 * The activation guard on training_groups already refuses an unverified field
 * or an unassignable trainer. What this adds is the two things the guard
 * cannot see: that there is a schedule at all, and that the sessions exist for
 * families to book into.
 */
create or replace function publish_training_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_times    integer;
  v_sessions integer;
  v_status   group_status;
begin
  perform assert_staff();

  select status into v_status from training_groups where id = p_group_id;
  if not found then
    raise exception 'Unknown group' using errcode = 'no_data_found';
  end if;

  select count(*) into v_times from group_meeting_times where group_id = p_group_id;
  if v_times = 0 then
    raise exception 'This group has no meeting times yet, so there is nothing to open'
      using errcode = 'check_violation';
  end if;

  v_sessions := generate_group_sessions(p_group_id);

  if v_status = 'draft' then
    update training_groups set status = 'forming', updated_at = now() where id = p_group_id;
  end if;

  perform write_audit('admin'::actor_kind, auth.uid(), 'group.published',
                      'training_groups', p_group_id,
                      jsonb_build_object('sessions_generated', v_sessions));

  return jsonb_build_object(
    'group_id', p_group_id,
    'status', (select status from training_groups where id = p_group_id),
    'meeting_times', v_times,
    'sessions_generated', v_sessions);
end;
$$;

/*
 * Close a group.
 *
 * Refuses while anyone has paid, because that is a refund conversation and not
 * a checkbox. p_force is for the case where those refunds have already been
 * made — it still records who did it and why.
 */
create or replace function cancel_training_group(
  p_group_id uuid,
  p_reason   text,
  p_force    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid integer;
begin
  perform assert_staff();

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Closing a group needs a reason — it goes to the families in it'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_paid
  from bookings b
  join sessions s on s.id = b.session_id
  where s.group_id = p_group_id and b.status = 'confirmed' and s.starts_at > now();

  if v_paid > 0 and not p_force then
    raise exception '% paid booking(s) remain in this group. Refund them first, or pass p_force once that is done', v_paid
      using errcode = 'check_violation';
  end if;

  update sessions
  set status = 'canceled', canceled_reason = p_reason, updated_at = now()
  where group_id = p_group_id and starts_at > now() and status = 'scheduled';

  update training_groups set status = 'canceled', updated_at = now() where id = p_group_id;

  perform write_audit('admin'::actor_kind, auth.uid(), 'group.canceled',
                      'training_groups', p_group_id,
                      jsonb_build_object('reason', p_reason, 'forced', p_force, 'paid_bookings', v_paid));

  return jsonb_build_object('group_id', p_group_id, 'paid_bookings', v_paid, 'forced', p_force);
end;
$$;

-- =============================================================================
-- Trainers
-- =============================================================================
-- The columns a trainer may not set for themselves — pay, status, background
-- check — are exactly the ones an administrator needs to. The protective
-- trigger already lets is_admin() through, so this function's only job is to
-- be the staff-guarded door.

create or replace function upsert_trainer(p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := nullif(p_details ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p_details ->> 'first_name', ''));
begin
  perform assert_staff();

  if v_id is null then
    if v_name = '' then
      raise exception 'A trainer needs a first name' using errcode = 'check_violation';
    end if;

    insert into trainers (
      first_name, last_name, email, phone, bio, photo_url,
      hourly_pay_cents, status, background_check_status)
    values (
      v_name,
      coalesce(p_details ->> 'last_name', ''),
      nullif(p_details ->> 'email', ''),
      coalesce(p_details ->> 'phone', ''),
      coalesce(p_details ->> 'bio', ''),
      coalesce(p_details ->> 'photo_url', ''),
      coalesce((p_details ->> 'hourly_pay_cents')::integer,
               setting_int('trainer_hourly_pay_cents', 4000)),
      coalesce(p_details ->> 'status', 'pending'),
      coalesce(p_details ->> 'background_check_status', 'not_started'))
    returning id into v_id;

    perform write_audit('admin'::actor_kind, auth.uid(), 'trainer.created', 'trainers', v_id,
                        p_details - 'hourly_pay_cents');
    return v_id;
  end if;

  update trainers set
    first_name              = coalesce(nullif(v_name, ''), first_name),
    last_name               = coalesce(p_details ->> 'last_name', last_name),
    email                   = coalesce(nullif(p_details ->> 'email', ''), email),
    phone                   = coalesce(p_details ->> 'phone', phone),
    bio                     = coalesce(p_details ->> 'bio', bio),
    photo_url               = coalesce(nullif(p_details ->> 'photo_url', ''), photo_url),
    hourly_pay_cents        = coalesce((p_details ->> 'hourly_pay_cents')::integer, hourly_pay_cents),
    status                  = coalesce(p_details ->> 'status', status),
    background_check_status = coalesce(p_details ->> 'background_check_status', background_check_status),
    background_check_expires_at = coalesce(nullif(p_details ->> 'background_check_expires_at', '')::date,
                                           background_check_expires_at),
    updated_at              = now()
  where id = v_id;

  if not found then
    raise exception 'Unknown trainer' using errcode = 'no_data_found';
  end if;

  perform write_audit('admin'::actor_kind, auth.uid(), 'trainer.updated', 'trainers', v_id,
                      p_details - 'hourly_pay_cents');
  return v_id;
end;
$$;

comment on function upsert_trainer is
  'The administrator door to the columns a trainer may not set for themselves. Pay is kept out of the audit payload — who changed it and when is the useful record, not the amount, which is on the row.';

-- =============================================================================
-- Grants
-- =============================================================================
-- Granted to authenticated because an administrator is an authenticated user.
-- assert_staff() in each body is the actual guard; the grant is not.

revoke all on function upsert_location(jsonb)                    from public, anon, authenticated;
revoke all on function verify_location(uuid, boolean)            from public, anon, authenticated;
revoke all on function upsert_season(jsonb)                      from public, anon, authenticated;
revoke all on function upsert_training_group(jsonb)              from public, anon, authenticated;
revoke all on function set_group_meeting_times(uuid, jsonb)      from public, anon, authenticated;
revoke all on function publish_training_group(uuid)              from public, anon, authenticated;
revoke all on function cancel_training_group(uuid, text, boolean) from public, anon, authenticated;
revoke all on function upsert_trainer(jsonb)                     from public, anon, authenticated;
revoke all on function generate_group_sessions(uuid)             from public, anon, authenticated;

grant execute on function upsert_location(jsonb)                    to authenticated;
grant execute on function verify_location(uuid, boolean)            to authenticated;
grant execute on function upsert_season(jsonb)                      to authenticated;
grant execute on function upsert_training_group(jsonb)              to authenticated;
grant execute on function set_group_meeting_times(uuid, jsonb)      to authenticated;
grant execute on function publish_training_group(uuid)              to authenticated;
grant execute on function cancel_training_group(uuid, text, boolean) to authenticated;
grant execute on function upsert_trainer(jsonb)                     to authenticated;
grant execute on function generate_group_sessions(uuid)             to authenticated;
