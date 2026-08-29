-- =============================================================================
-- 0012 — Scheduled work
-- =============================================================================
-- The jobs live here rather than in the edge function on purpose. A cron in a
-- serverless function is a thing that can fire twice, fire late, or fire while
-- the previous run is still going. Putting the work in the database means each
-- job takes its own row locks, records what it did, and can be run by hand from
-- psql at three in the morning without a deploy.
--
-- The edge function's only job is to say "it is time" — every rule about what
-- happens then is here.
-- =============================================================================

-- A household needs somewhere to be spoken to. Find the open thread or open one.
create or replace function conversation_for_household(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_phone text;
  v_contact uuid;
begin
  select id into v_id
  from conversations
  where household_id = p_household_id and state <> 'closed'
  order by last_message_at desc nulls last
  limit 1;

  if found then
    return v_id;
  end if;

  select id, phone into v_contact, v_phone
  from contacts
  where household_id = p_household_id and is_primary
  limit 1;

  insert into conversations (household_id, contact_id, channel, phone_number)
  values (p_household_id, v_contact, 'sms', v_phone)
  returning id into v_id;

  return v_id;
end;
$$;

-- =============================================================================
-- Reminders
-- =============================================================================
-- reminder_hours_before is a JSON array in settings — [24, 2] initially. The
-- dedupe key carries the booking and the offset, so running this job every
-- hour sends each reminder exactly once.

create or replace function send_session_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours   integer;
  v_row     record;
  v_conv    uuid;
  v_msg     messages%rowtype;
  v_n       integer := 0;
  v_offsets jsonb;
  -- Transaction time, not clock time: messages.created_at defaults to now(),
  -- so a row written by this run compares equal and one from an earlier run
  -- compares strictly less.
  v_started timestamptz := now();
  v_tz      text := setting_text('display_timezone', 'America/New_York');
begin
  if automation_paused() then
    return 0;
  end if;

  select coalesce(value::jsonb, '[24,2]'::jsonb) into v_offsets
  from system_settings where key = 'reminder_hours_before';

  for v_hours in select (jsonb_array_elements_text(coalesce(v_offsets, '[24,2]'::jsonb)))::integer
  loop
    for v_row in
      select b.id as booking_id, b.household_id, p.first_name, s.starts_at,
             coalesce(l.name, 'the usual field') as place
      from bookings b
      join sessions s  on s.id = b.session_id
      join players  p  on p.id = b.player_id
      left join locations l on l.id = s.location_id
      where b.status = 'confirmed'
        and s.status = 'scheduled'
        -- Inside the hour that this offset lands in. Run hourly, so each
        -- booking crosses each window once.
        and s.starts_at >  now() + make_interval(hours => v_hours) - interval '1 hour'
        and s.starts_at <= now() + make_interval(hours => v_hours)
    loop
      v_conv := conversation_for_household(v_row.household_id);

      begin
        -- Local time, not the server's. A parent told "training at 12:10pm"
        -- when the field opens at 8:10 their time is worse than no reminder.
        v_msg := queue_outbound_message(
          v_conv,
          format('Reminder: %s has training at %s on %s.',
                 v_row.first_name,
                 to_char(v_row.starts_at at time zone v_tz, 'FMHH12:MIam'),
                 v_row.place),
          format('reminder:%s:%s', v_row.booking_id, v_hours),
          'ai',
          jsonb_build_object('booking_id', v_row.booking_id)
        );

        -- Only count what was actually sent. A de-duplicated call returns the
        -- message from the first run, and a job log that claims to have sent
        -- something it did not is worse than no log.
        if v_msg.created_at >= v_started then
          v_n := v_n + 1;
        end if;
      exception when check_violation then
        -- A human owns the thread, or automation was paused mid-run. Skipping
        -- one reminder is the right answer; failing the whole job is not.
        null;
      end;
    end loop;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- Waitlists
-- =============================================================================

create or replace function promote_all_waitlists()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_n integer := 0;
begin
  for v_group in
    select distinct w.group_id
    from waitlists w
    join training_groups g on g.id = w.group_id
    where w.state = 'waiting'
      and g.status in ('forming','confirmed','full')
  loop
    if promote_waitlist(v_group) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- Groups that are close
-- =============================================================================
-- A group one paid family short of running is the single highest-value thing
-- the business can know each morning. This does not message anyone — it raises
-- it, so a person or the agent decides.

create or replace function flag_groups_near_threshold()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  for v_row in
    select g.id, g.name, g.min_players, o.paid
    from training_groups g
    cross join lateral group_occupancy(g.id) o
    where g.status = 'forming'
      and o.paid = g.min_players - 1
  loop
    -- One escalation per group per day, not one per run.
    if not exists (
      select 1 from escalations
      where subject_table = 'training_groups' and subject_id = v_row.id
        and source = 'scheduling' and raised_at > now() - interval '20 hours'
    ) then
      perform escalate('scheduling',
        format('%s is one paid family short of running', v_row.name),
        'normal', 'training_groups', v_row.id,
        jsonb_build_object('paid', v_row.paid, 'needed', v_row.min_players));
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- Sessions that have finished
-- =============================================================================

create or replace function complete_past_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with done as (
    update sessions set status = 'completed'
    where status = 'scheduled' and ends_at < now() - interval '2 hours'
    returning id
  )
  select count(*) into v_n from done;

  update trainer_shifts
  set status = 'completed', completed_at = now()
  where status in ('confirmed','in_progress') and ends_at < now() - interval '2 hours';

  return v_n;
end;
$$;

-- Pay every completed shift that has not been paid. record_trainer_hours() is
-- unique on the shift, so running this twice pays once.
create or replace function record_completed_shift_hours()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_n integer := 0;
begin
  for v_shift in
    select s.id from trainer_shifts s
    where s.status = 'completed'
      and not exists (select 1 from trainer_hours h where h.shift_id = s.id)
  loop
    perform record_trainer_hours(v_shift);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- The dispatcher
-- =============================================================================
-- One entry point. The edge function calls this with a tier; nothing about
-- what a tier contains is decided outside the database.

create or replace function run_scheduled_job(p_job_key text, p_tier text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_items  integer := 0;
  v_detail jsonb := '{}'::jsonb;
begin
  -- The pause switch stops everything except the two jobs that only ever
  -- release things. Holding a family's spot hostage during an incident helps
  -- nobody.
  if automation_paused() and p_job_key not in ('expire_holds','expire_checkouts') then
    return jsonb_build_object('skipped', true, 'reason', 'automation_paused');
  end if;

  insert into scheduled_jobs (job_key, tier) values (p_job_key, p_tier)
  returning id into v_job_id;

  begin
    case p_job_key
      when 'expire_holds'        then v_items := expire_booking_holds();
      when 'expire_checkouts'    then v_items := expire_checkout_intents();
      when 'lapse_invites'       then v_items := lapse_waitlist_invites();
      when 'promote_waitlists'   then v_items := promote_all_waitlists();
      when 'send_reminders'      then v_items := send_session_reminders();
      when 'expire_credits'      then v_items := expire_package_credits();
      when 'complete_sessions'   then v_items := complete_past_sessions();
      when 'record_hours'        then v_items := record_completed_shift_hours();
      when 'flag_near_threshold' then v_items := flag_groups_near_threshold();
      else
        raise exception 'Unknown job %', p_job_key using errcode = 'check_violation';
    end case;

    update scheduled_jobs
    set finished_at = now(), succeeded = true, items_processed = v_items
    where id = v_job_id;

    return jsonb_build_object('job', p_job_key, 'items', v_items, 'succeeded', true);

  exception when others then
    update scheduled_jobs
    set finished_at = now(), succeeded = false, error = sqlerrm
    where id = v_job_id;

    perform escalate('scheduling', format('Job %s failed: %s', p_job_key, sqlerrm),
                     'urgent', 'scheduled_jobs', v_job_id);

    return jsonb_build_object('job', p_job_key, 'succeeded', false, 'error', sqlerrm);
  end;
end;
$$;

comment on function run_scheduled_job is
  'Every scheduled job, in one place, recorded in scheduled_jobs. A failure escalates rather than disappearing into a function log.';

-- What each tier runs. Kept as data so the schedule can change without a
-- deploy — the edge function asks the database what a tier means.
create or replace function jobs_for_tier(p_tier text)
returns text[]
language sql
immutable
as $$
  select case p_tier
    when 'five_minute' then array['expire_holds','expire_checkouts']
    when 'hourly'      then array['lapse_invites','promote_waitlists','send_reminders','complete_sessions']
    when 'daily'       then array['expire_credits','record_hours','flag_near_threshold']
    when 'weekly'      then array[]::text[]
    else array[]::text[]
  end;
$$;

create or replace function run_tier(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_out jsonb := '[]'::jsonb;
begin
  foreach v_key in array jobs_for_tier(p_tier)
  loop
    v_out := v_out || jsonb_build_array(run_scheduled_job(v_key, p_tier));
  end loop;

  return jsonb_build_object('tier', p_tier, 'results', v_out);
end;
$$;
