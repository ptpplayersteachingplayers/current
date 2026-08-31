-- =============================================================================
-- 0022 — Modules
-- =============================================================================
-- The platform runs camps, training, payments and the portals. Things built on
-- top of it — the AI agent, the CRM sync, whatever comes next — are modules:
-- installed separately, removable, and unable to be a dependency of the core.
--
-- Two things make that real rather than a folder convention:
--
--   1. A registry. A module declares its scheduled work here instead of a case
--      arm being added to the platform's job dispatcher. Before this, adding a
--      job meant editing core, which is the opposite of a plugin.
--
--   2. A test. verify.sh applies the core alone and asserts the whole booking
--      path still works, then applies the modules and asserts they do too. A
--      module that the platform has quietly come to depend on fails the first
--      half.
-- =============================================================================

create table platform_modules (
  name         text primary key,
  version      text not null default '1.0.0',
  description  text not null default '',
  installed_at timestamptz not null default now(),
  enabled      boolean not null default true
);

comment on table platform_modules is
  'What is installed on top of the platform. A module that is absent must never be an error — only a capability the operator does not have.';

create table module_jobs (
  id          uuid primary key default gen_random_uuid(),
  module      text not null references platform_modules (name) on delete cascade,
  job_key     text not null unique,
  tier        text not null check (tier in ('five_minute','hourly','daily','weekly','manual')),
  -- The function to call. Registered by name so the platform's dispatcher does
  -- not need to know it exists.
  function_name text not null,
  -- Whether the job may run while automation is paused. True only for work
  -- that releases something a family is holding.
  runs_when_paused boolean not null default false,
  position    smallint not null default 100,
  enabled     boolean not null default true,

  created_at  timestamptz not null default now()
);

create index module_jobs_tier_idx on module_jobs (tier, position) where enabled;

create or replace function register_module(
  p_name text,
  p_version text default '1.0.0',
  p_description text default ''
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into platform_modules (name, version, description)
  values (p_name, p_version, p_description)
  on conflict (name) do update
    set version = excluded.version, description = excluded.description;
$$;

create or replace function register_module_job(
  p_module text,
  p_job_key text,
  p_tier text,
  p_function_name text,
  p_runs_when_paused boolean default false,
  p_position smallint default 100
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into module_jobs (module, job_key, tier, function_name, runs_when_paused, position)
  values (p_module, p_job_key, p_tier, p_function_name, p_runs_when_paused, p_position)
  on conflict (job_key) do update
    set tier = excluded.tier,
        function_name = excluded.function_name,
        runs_when_paused = excluded.runs_when_paused,
        position = excluded.position,
        enabled = true;
$$;

-- The platform's own jobs are registered the same way a module's are, so there
-- is one list rather than a built-in list and an extension list that behave
-- differently.
create table core_jobs (
  job_key      text primary key,
  tier         text not null,
  function_name text not null,
  runs_when_paused boolean not null default false,
  position     smallint not null default 10
);

insert into core_jobs (job_key, tier, function_name, runs_when_paused, position) values
  ('expire_holds',           'five_minute', 'expire_booking_holds',        true,  10),
  ('expire_camp_holds',      'five_minute', 'expire_camp_holds',           true,  11),
  ('expire_checkouts',       'five_minute', 'expire_checkout_intents',     true,  12),
  ('reap_webhook_claims',    'five_minute', 'reap_stale_webhook_claims',   true,  13),
  ('lapse_invites',          'hourly',      'lapse_waitlist_invites',      false, 20),
  ('promote_waitlists',      'hourly',      'promote_all_waitlists',       false, 21),
  ('promote_camp_waitlists', 'hourly',      'promote_all_camp_waitlists',  false, 22),
  ('send_reminders',         'hourly',      'send_session_reminders',      false, 23),
  ('complete_sessions',      'hourly',      'complete_past_sessions',      false, 24),
  ('release_credits',        'hourly',      'release_stranded_credits',    true,  25),
  ('expire_credits',         'daily',       'expire_package_credits',      false, 30),
  ('record_hours',           'daily',       'record_completed_shift_hours', false, 31),
  ('flag_near_threshold',    'daily',       'flag_groups_near_threshold',  false, 32),
  ('archive_past_camps',     'daily',       'archive_past_camps',          false, 33),
  ('weekly_report',          'weekly',      'record_weekly_report',        false, 40)
on conflict (job_key) do nothing;

-- =============================================================================
-- The dispatcher, driven by the registry
-- =============================================================================

create or replace function jobs_for_tier(p_tier text)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(job_key order by position, job_key), '{}')
  from (
    select job_key, position from core_jobs where tier = p_tier
    union all
    select j.job_key, j.position
    from module_jobs j
    join platform_modules m on m.name = j.module
    where j.tier = p_tier and j.enabled and m.enabled
  ) all_jobs;
$$;

create or replace function run_scheduled_job(p_job_key text, p_tier text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id   uuid;
  v_items    integer := 0;
  v_function text;
  v_paused_ok boolean;
begin
  perform assert_service_only('Running a scheduled job');

  select function_name, runs_when_paused into v_function, v_paused_ok
  from (
    select function_name, runs_when_paused from core_jobs where job_key = p_job_key
    union all
    select j.function_name, j.runs_when_paused
    from module_jobs j
    join platform_modules m on m.name = j.module
    where j.job_key = p_job_key and j.enabled and m.enabled
  ) found
  limit 1;

  -- A job key that is not registered is a job whose module is not installed,
  -- or a typo. Both are worth saying out loud rather than silently doing
  -- nothing.
  if v_function is null then
    return jsonb_build_object('job', p_job_key, 'succeeded', false,
                              'error', 'No such job is registered');
  end if;

  if automation_paused() and not v_paused_ok then
    return jsonb_build_object('skipped', true, 'reason', 'automation_paused');
  end if;

  insert into scheduled_jobs (job_key, tier) values (p_job_key, p_tier)
  returning id into v_job_id;

  begin
    -- %I quotes the identifier, so a function name in the registry cannot be
    -- anything but a function name.
    execute format('select %I()', v_function) into v_items;

    update scheduled_jobs
    set finished_at = now(), succeeded = true, items_processed = coalesce(v_items, 0)
    where id = v_job_id;

    return jsonb_build_object('job', p_job_key, 'items', coalesce(v_items, 0), 'succeeded', true);

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
  'Dispatches by looking the job up, so a module adds scheduled work by registering it rather than by editing this function.';

alter table platform_modules enable row level security;
alter table module_jobs      enable row level security;
alter table core_jobs        enable row level security;

create policy platform_modules_admin on platform_modules
  for all to authenticated using (is_admin()) with check (is_admin());
create policy module_jobs_admin on module_jobs
  for all to authenticated using (is_admin()) with check (is_admin());
create policy core_jobs_admin on core_jobs
  for all to authenticated using (is_admin()) with check (is_admin());

revoke all on function register_module(text, text, text) from public, anon, authenticated;
revoke all on function register_module_job(text, text, text, text, boolean, smallint)
  from public, anon, authenticated;

-- =============================================================================
-- Numbers a module contributes
-- =============================================================================
-- The weekly summary wants a count of families awaiting follow-up. That number
-- only exists when the agent module is installed. Rather than the platform
-- reading a table it cannot assume exists, a module registers a function that
-- produces the number, and the platform asks for it by name.

create table module_metrics (
  metric_key    text primary key,
  module        text not null references platform_modules (name) on delete cascade,
  function_name text not null,
  created_at    timestamptz not null default now()
);

comment on table module_metrics is
  'A number the platform reports but does not compute. Absent module, absent metric, and every caller gets zero rather than an error.';

create or replace function register_module_metric(
  p_module text,
  p_metric_key text,
  p_function_name text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into module_metrics (metric_key, module, function_name)
  values (p_metric_key, p_module, p_function_name)
  on conflict (metric_key) do update
    set module = excluded.module, function_name = excluded.function_name;
$$;

create or replace function module_metric(p_metric_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_function text;
  v_value    bigint;
begin
  select m.function_name into v_function
  from module_metrics m
  join platform_modules p on p.name = m.module
  where m.metric_key = p_metric_key and p.enabled;

  if v_function is null then
    return 0;
  end if;

  execute format('select %I()', v_function) into v_value;
  return coalesce(v_value, 0);
end;
$$;

comment on function module_metric is
  'Zero when the module is not installed. A missing capability is not a missing table.';

alter table module_metrics enable row level security;
create policy module_metrics_admin on module_metrics
  for all to authenticated using (is_admin()) with check (is_admin());

revoke all on function register_module_metric(text, text, text) from public, anon, authenticated;
revoke all on function module_metric(text) from public, anon, authenticated;
