-- =============================================================================
-- 0021 — Reports, payroll and the operations view
-- =============================================================================
-- The weekly tier from the brief, plus the two things an administrator needs
-- every morning: what needs a person, and what is about to go wrong.
--
-- All of it is SQL. A report defined in a dashboard is a report nobody can
-- test, nobody can reproduce, and nobody can point at when the number looks
-- wrong. Defined here, "utilisation" means one thing and the admin screen and
-- the weekly email cannot disagree about it.
-- =============================================================================

-- =============================================================================
-- Payroll
-- =============================================================================
-- What each trainer is owed for a period, from trainer_hours, which is written
-- from confirmed shifts and is idempotent on the shift. Nothing here computes
-- pay; it totals what was already recorded.

create or replace function payroll_for_period(p_from date, p_to date)
returns table (
  trainer_id uuid,
  trainer_name text,
  stripe_account_id text,
  sessions integer,
  minutes integer,
  hours numeric,
  amount_cents bigint,
  unpaid_cents bigint,
  first_worked date,
  last_worked date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- An administrator is an authenticated user, so the grant has to include
  -- `authenticated` — which makes the guard inside the body the only thing
  -- separating a parent from the payroll. A SECURITY DEFINER function granted
  -- to a role is not a function only that role's admins can call.
  perform assert_staff();

  return query
  select
    t.id,
    t.display_name,
    t.stripe_account_id,
    count(*)::integer,
    sum(h.minutes)::integer,
    round(sum(h.minutes) / 60.0, 2),
    sum(h.amount_cents)::bigint,
    sum(h.amount_cents) filter (where h.paid_at is null)::bigint,
    min(h.worked_on),
    max(h.worked_on)
  from trainer_hours h
  join trainers t on t.id = h.trainer_id
  where h.worked_on between p_from and p_to
  group by t.id, t.display_name, t.stripe_account_id
  order by t.display_name;
end;
$$;

comment on function payroll_for_period is
  'Totals what was recorded, and computes nothing. Pay is decided when a shift is completed; this is the arithmetic on top of it.';

-- Marking a payroll run as paid. Idempotent on the reference, so re-running an
-- export cannot mark the same hours paid twice under two batch numbers.
create or replace function mark_payroll_paid(
  p_trainer_id uuid,
  p_from date,
  p_to date,
  p_reference text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform assert_staff();

  with paid as (
    update trainer_hours
    set paid_at = now(), status = 'paid', stripe_transfer_id = p_reference
    where trainer_id = p_trainer_id
      and worked_on between p_from and p_to
      and paid_at is null
    returning id
  )
  select count(*) into v_n from paid;

  if v_n > 0 then
    perform write_audit('admin', auth.uid(), 'payroll.paid', 'trainers', p_trainer_id,
                        null, jsonb_build_object('from', p_from, 'to', p_to,
                                                 'reference', p_reference, 'entries', v_n));
  end if;

  return v_n;
end;
$$;

-- =============================================================================
-- Utilisation
-- =============================================================================
-- One definition each for camps and for groups, so the admin screen, the
-- weekly summary and the agent all use the same number.

create or replace function camp_utilisation(p_season_year smallint default null)
returns table (
  camp_id uuid,
  name text,
  city text,
  state text,
  starts_on date,
  status camp_status,
  capacity integer,
  registered integer,
  fill_rate numeric,
  revenue_cents bigint,
  days_until integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  return query
  select
    c.id, c.name, c.city, c.state, c.starts_on, c.status,
    o.capacity, o.paid,
    case when o.capacity = 0 then 0 else round(o.paid::numeric / o.capacity, 3) end,
    coalesce((select sum(r.price_cents) from camp_registrations r
              where r.camp_id = c.id and r.status in ('confirmed','attended')), 0)::bigint,
    (c.starts_on - current_date)
  from camps c
  cross join lateral camp_occupancy(c.id) o
  where c.status not in ('draft','canceled','archived')
    and (p_season_year is null or c.season_year = p_season_year)
  order by c.starts_on;
end;
$$;

create or replace function group_utilisation(p_season_id uuid default null)
returns table (
  group_id uuid,
  name text,
  status group_status,
  min_players integer,
  paid integer,
  capacity integer,
  fill_rate numeric,
  short_by integer,
  revenue_cents bigint,
  sessions_remaining integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  return query
  select
    g.id, g.name, g.status,
    g.min_players::integer, o.paid, o.capacity,
    case when o.capacity = 0 then 0 else round(o.paid::numeric / o.capacity, 3) end,
    greatest(0, g.min_players - o.paid),
    coalesce((select sum(pk.price_cents) from enrollments e
              join packages pk on pk.id = e.package_id
              where e.group_id = g.id and e.state = 'active'), 0)::bigint,
    (select count(*)::integer from sessions s
     where s.group_id = g.id and s.status = 'scheduled' and s.starts_at > now())
  from training_groups g
  cross join lateral group_occupancy(g.id) o
  where g.status not in ('draft','canceled')
    and (p_season_id is null or g.season_id = p_season_id)
  order by greatest(0, g.min_players - o.paid) desc, g.name;
end;
$$;

-- =============================================================================
-- Attendance
-- =============================================================================
-- Not used for pay, and worth saying again here: this is about whether the
-- coaching is landing, not about what anyone is owed.

create or replace function attendance_summary(p_from date, p_to date)
returns table (
  group_id uuid,
  group_name text,
  expected integer,
  present integer,
  late integer,
  absent integer,
  attendance_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  return query
  select
    g.id, g.name,
    count(a.*)::integer,
    count(*) filter (where a.state = 'present')::integer,
    count(*) filter (where a.state = 'late')::integer,
    count(*) filter (where a.state = 'absent')::integer,
    case when count(a.*) = 0 then null
         else round(count(*) filter (where a.state in ('present','late'))::numeric / count(a.*), 3)
    end
  from attendance a
  join sessions s on s.id = a.session_id
  join training_groups g on g.id = s.group_id
  where s.starts_at::date between p_from and p_to
  group by g.id, g.name
  order by 7 nulls last;
end;
$$;

-- =============================================================================
-- The morning view
-- =============================================================================
-- What needs a person today, in the order it needs them. One query, because an
-- administrator opening a screen should not have to visit six of them to find
-- out whether anything is wrong.

create or replace function operations_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  return jsonb_build_object(
    'escalations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'severity', e.severity, 'summary', e.summary,
        'source', e.source, 'raised_at', e.raised_at, 'due_at', e.due_at,
        'overdue', e.due_at < now(),
        'recommended_action', e.recommended_action,
        'household', h.display_name,
        'contact', c.first_name || ' ' || c.last_name,
        'phone', c.phone,
        'conversation_id', e.conversation_id)
        order by (e.due_at < now()) desc,
                 case e.severity when 'urgent' then 0 when 'normal' then 1 else 2 end,
                 e.raised_at)
      from escalations e
      left join households h on h.id = e.household_id
      left join contacts c on c.id = e.contact_id
      where e.state in ('open','acknowledged')), '[]'::jsonb),

    -- Groups one family from running. The highest-value thing the business can
    -- know each morning.
    'groups_nearly_running', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.group_id, 'name', u.name, 'paid', u.paid,
        'short_by', u.short_by, 'sessions_remaining', u.sessions_remaining))
      from group_utilisation() u
      where u.short_by between 1 and 2 and u.status = 'forming'), '[]'::jsonb),

    -- Camps that are not selling with the clock running.
    'camps_at_risk', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.camp_id, 'name', u.name, 'city', u.city,
        'fill_rate', u.fill_rate, 'days_until', u.days_until,
        'registered', u.registered, 'capacity', u.capacity))
      from camp_utilisation() u
      where u.days_until between 0 and 45 and u.fill_rate < 0.5), '[]'::jsonb),

    -- Money that started and did not finish.
    'unpaid_checkouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id, 'kind', ci.kind, 'amount_cents', ci.amount_cents,
        'created_at', ci.created_at, 'household', h.display_name))
      from checkout_intents ci
      join households h on h.id = ci.household_id
      where ci.state = 'submitted' and ci.created_at > now() - interval '7 days'), '[]'::jsonb),

    -- Anything the machinery could not do by itself.
    'failed_jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job_key', j.job_key, 'started_at', j.started_at, 'error', j.error))
      from scheduled_jobs j
      where j.succeeded = false and j.started_at > now() - interval '24 hours'), '[]'::jsonb),

    'stuck_webhooks', (
      select count(*) from webhook_events
      where failed_at is not null and processed_at is null),

    -- Fields nobody has confirmed, which is what stops a group opening.
    'unverified_fields', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'city', l.city))
      from locations l
      where l.active and l.verified_at is null
        and exists (select 1 from training_groups g where g.location_id = l.id)), '[]'::jsonb),

    'automation_paused', automation_paused(),

    'sessions_today', (
      select count(*) from sessions
      where starts_at::date = (now() at time zone setting_text('display_timezone','America/New_York'))::date
        and status = 'scheduled')
  );
end;
$$;

-- =============================================================================
-- The weekly summary
-- =============================================================================

create or replace function weekly_summary(p_ending date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := p_ending - 6;
begin
  perform assert_staff();

  return jsonb_build_object(
    'week', jsonb_build_object('from', v_from, 'to', p_ending),

    'revenue', jsonb_build_object(
      'gross_cents', coalesce((select sum(amount_cents) from payments
        where succeeded_at::date between v_from and p_ending and status in ('succeeded','partially_refunded')), 0),
      'refunded_cents', coalesce((select sum(amount_cents) from refunds
        where created_at::date between v_from and p_ending), 0),
      'by_kind', coalesce((
        select jsonb_object_agg(description, total)
        from (select description, sum(amount_cents) as total from payments
              where succeeded_at::date between v_from and p_ending
              group by description) k), '{}'::jsonb)),

    'payroll', jsonb_build_object(
      'owed_cents', coalesce((select sum(amount_cents) from trainer_hours
        where worked_on between v_from and p_ending), 0),
      'unpaid_cents', coalesce((select sum(amount_cents) from trainer_hours
        where worked_on between v_from and p_ending and paid_at is null), 0),
      'by_trainer', coalesce((
        select jsonb_agg(jsonb_build_object('trainer', trainer_name, 'hours', hours,
                                            'amount_cents', amount_cents))
        from payroll_for_period(v_from, p_ending)), '[]'::jsonb)),

    'sessions', jsonb_build_object(
      'ran', (select count(*) from sessions
              where starts_at::date between v_from and p_ending and status = 'completed'),
      'canceled', (select count(*) from sessions
                   where starts_at::date between v_from and p_ending and status = 'canceled')),

    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('group', group_name, 'rate', attendance_rate,
                                          'expected', expected))
      from attendance_summary(v_from, p_ending)), '[]'::jsonb),

    'new_families', (select count(*) from households where created_at::date between v_from and p_ending),

    'underperforming', jsonb_build_object(
      'camps', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'fill_rate', fill_rate,
                                            'days_until', days_until))
        from camp_utilisation() where days_until between 0 and 60 and fill_rate < 0.5), '[]'::jsonb),
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'paid', paid, 'short_by', short_by))
        from group_utilisation() where status = 'forming'), '[]'::jsonb)),

    -- Contributed by the agent module. Zero when it is not installed; the
    -- platform does not read that module's tables directly.
    'needs_follow_up', module_metric('pending_followups'),
    'open_escalations', (select count(*) from escalations where state in ('open','acknowledged'))
  );
end;
$$;

comment on function weekly_summary is
  'One week, one object. Defined in SQL so the number in the admin screen and the number in the weekly email cannot disagree.';

-- =============================================================================
-- Working the queue
-- =============================================================================

create or replace function resolve_escalation(
  p_escalation_id uuid,
  p_resolution text,
  p_reopen_conversation boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row escalations%rowtype;
begin
  perform assert_staff();

  select * into v_row from escalations where id = p_escalation_id for update;
  if not found then
    raise exception 'Unknown escalation' using errcode = 'no_data_found';
  end if;

  update escalations
  set state = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = p_resolution
  where id = p_escalation_id;

  -- Handing the thread back to the agent is deliberate rather than automatic.
  -- Most escalations end with a person still owning the relationship.
  if p_reopen_conversation and v_row.conversation_id is not null then
    update conversations
    set human_owned = false, agent_state = 'follow_up_required', escalation_id = null
    where id = v_row.conversation_id;
  end if;

  perform write_audit('admin', auth.uid(), 'escalation.resolved', 'escalations', p_escalation_id,
                      jsonb_build_object('state', v_row.state),
                      jsonb_build_object('resolution', p_resolution,
                                         'agent_resumed', p_reopen_conversation));
end;
$$;

create or replace function acknowledge_escalation(p_escalation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  update escalations set state = 'acknowledged' where id = p_escalation_id and state = 'open';

  perform write_audit('admin', auth.uid(), 'escalation.acknowledged', 'escalations',
                      p_escalation_id, null, '{}'::jsonb);
end;
$$;

-- The switch, as a function, so pausing everything is one call that is
-- recorded rather than a row somebody edits.
create or replace function set_automation_paused(p_paused boolean, p_reason text default '')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_staff();

  update system_settings
  set value = to_jsonb(p_paused), updated_at = now(), updated_by = auth.uid()
  where key = 'automation_paused';

  perform write_audit('admin', auth.uid(),
                      case when p_paused then 'automation.paused' else 'automation.resumed' end,
                      'system_settings', null, null,
                      jsonb_build_object('reason', p_reason));

  return p_paused;
end;
$$;

-- =============================================================================
-- Grants
-- =============================================================================
-- Staff only. Every one of these reads across households.

revoke all on function payroll_for_period(date, date) from public, anon, authenticated;
revoke all on function mark_payroll_paid(uuid, date, date, text) from public, anon, authenticated;
revoke all on function camp_utilisation(smallint) from public, anon, authenticated;
revoke all on function group_utilisation(uuid) from public, anon, authenticated;
revoke all on function attendance_summary(date, date) from public, anon, authenticated;
revoke all on function operations_today() from public, anon, authenticated;
revoke all on function weekly_summary(date) from public, anon, authenticated;
revoke all on function resolve_escalation(uuid, text, boolean) from public, anon, authenticated;
revoke all on function acknowledge_escalation(uuid) from public, anon, authenticated;
revoke all on function set_automation_paused(boolean, text) from public, anon, authenticated;

-- An administrator is an authenticated user with a claim, so these have to be
-- callable by `authenticated` — the assert_staff() inside each one is what
-- separates an administrator from a parent, and it is checked against the JWT
-- rather than against a table a client could write to.
grant execute on function payroll_for_period(date, date) to authenticated;
grant execute on function mark_payroll_paid(uuid, date, date, text) to authenticated;
grant execute on function camp_utilisation(smallint) to authenticated;
grant execute on function group_utilisation(uuid) to authenticated;
grant execute on function attendance_summary(date, date) to authenticated;
grant execute on function operations_today() to authenticated;
grant execute on function weekly_summary(date) to authenticated;
grant execute on function resolve_escalation(uuid, text, boolean) to authenticated;
grant execute on function acknowledge_escalation(uuid) to authenticated;
grant execute on function set_automation_paused(boolean, text) to authenticated;
grant execute on function assert_staff() to authenticated;

-- The weekly job below is registered in core_jobs by migration 0020. The
-- dispatcher reads that registry, so adding weekly work no longer means
-- editing a case statement — which is what makes a module possible.

-- The weekly job records the summary rather than emailing it. Sending is the
-- edge function's job; having a durable copy of what was true that week is
-- this one's.
create or replace function record_weekly_report()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary jsonb;
begin
  v_summary := weekly_summary(current_date);

  insert into scheduled_jobs (job_key, tier, finished_at, succeeded, items_processed, detail)
  values ('weekly_report_snapshot', 'weekly', now(), true, 1, v_summary);

  -- Anything genuinely wrong gets raised rather than left in a report nobody
  -- opens.
  if jsonb_array_length(v_summary -> 'underperforming' -> 'camps') > 0 then
    perform escalate('scheduling',
      format('%s camps are under half full inside sixty days',
             jsonb_array_length(v_summary -> 'underperforming' -> 'camps')),
      'normal', 'camps', null, v_summary -> 'underperforming' -> 'camps');
  end if;

  return 1;
end;
$$;

