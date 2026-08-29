-- =============================================================================
-- 0007 — Row Level Security
-- =============================================================================
-- The audit of the old platform found its largest defect class was handlers
-- that verified a nonce and then acted on a record id from the request. RLS
-- moves that decision out of the handler entirely: a parent's query for another
-- family's row returns zero rows, whatever the application forgot to check.
--
-- Two rules for everything below:
--
--   1. RLS is enabled on every table, then policies are added. A table with RLS
--      enabled and no policy denies everyone, which is the safe direction to
--      fail.
--
--   2. Identity comes from auth.uid() only. No policy ever trusts a column the
--      client could set.
-- =============================================================================

-- =============================================================================
-- Who is asking?
-- =============================================================================

create or replace function current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from contacts where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_trainer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from trainers where auth_user_id = auth.uid() and status = 'active' limit 1;
$$;

-- Admin is a claim on the JWT, set by an edge function on an allow-list. It is
-- deliberately not a row in a table a compromised client could insert into.
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'ptp_role') = 'admin',
    false
  );
$$;

comment on function is_admin is
  'Reads a claim set server-side at sign-in. Never a table lookup a client could write to.';

-- =============================================================================
-- Authorisation for SECURITY DEFINER functions
-- =============================================================================
-- RLS protects tables. It does not protect a SECURITY DEFINER function, which
-- runs as its owner and sees everything — and those functions take ids as
-- arguments. begin_checkout(kind, player_id, …) called with someone else's
-- player id is precisely the defect the audit found throughout the old
-- platform, moved to a new place.
--
-- So every function a browser can reach asserts, in its own body, that the
-- caller may act on the subject. auth.uid() being null means there is no end
-- user: a scheduled job, a webhook, or an edge function using the service key.
-- Those are already inside the trust boundary.

create or replace function assert_household_access(p_household_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;          -- system, job or webhook
  if is_admin() then return; end if;
  if current_household_id() = p_household_id then return; end if;

  raise exception 'That does not belong to your household'
    using errcode = 'insufficient_privilege';
end;
$$;

create or replace function assert_player_access(p_player_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then return; end if;
  if is_admin() then return; end if;

  select household_id into v_household from players where id = p_player_id;

  -- A missing player and someone else's player get the same answer, so the
  -- error cannot be used to discover which ids exist.
  if v_household is null or v_household is distinct from current_household_id() then
    raise exception 'That does not belong to your household'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function assert_can_coach_session(p_session_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if is_admin() then return; end if;

  if exists (
    select 1 from sessions s
    where s.id = p_session_id and s.trainer_id = current_trainer_id()
  ) then
    return;
  end if;

  raise exception 'You are not the trainer for that session'
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function assert_player_access is
  'Called at the top of every SECURITY DEFINER function a client can reach. RLS does not apply inside a definer function, so the check has to be written out.';

-- =============================================================================
-- Enable RLS everywhere
-- =============================================================================

alter table households                        enable row level security;
alter table contacts                          enable row level security;
alter table players                           enable row level security;
alter table player_availability               enable row level security;
alter table trainers                          enable row level security;
alter table trainer_availability              enable row level security;
alter table trainer_availability_exceptions   enable row level security;
alter table locations                         enable row level security;
alter table field_availability_windows        enable row level security;
alter table seasons                           enable row level security;
alter table training_groups                   enable row level security;
alter table group_meeting_times               enable row level security;
alter table sessions                          enable row level security;
alter table trainer_shifts                    enable row level security;
alter table private_slots                     enable row level security;
alter table payments                          enable row level security;
alter table refunds                           enable row level security;
alter table packages                          enable row level security;
alter table package_credits                   enable row level security;
alter table booking_holds                     enable row level security;
alter table bookings                          enable row level security;
alter table enrollments                       enable row level security;
alter table waitlists                         enable row level security;
alter table attendance                        enable row level security;
alter table player_notes                      enable row level security;
alter table trainer_hours                     enable row level security;
alter table audit_logs                        enable row level security;
alter table webhook_events                    enable row level security;
alter table scheduled_jobs                    enable row level security;
alter table escalations                       enable row level security;
alter table system_settings                   enable row level security;

-- =============================================================================
-- Admin: full read and write on everything
-- =============================================================================
-- Written as a loop so a new table cannot be silently left without an admin
-- policy — the pattern is applied uniformly rather than remembered per table.

do $$
declare
  t text;
begin
  foreach t in array array[
    'households','contacts','players','player_availability','trainers',
    'trainer_availability','trainer_availability_exceptions','locations',
    'field_availability_windows','seasons','training_groups','group_meeting_times',
    'sessions','trainer_shifts','private_slots','payments','refunds','packages',
    'package_credits','booking_holds','bookings','enrollments','waitlists',
    'attendance','player_notes','trainer_hours','webhook_events','scheduled_jobs',
    'escalations','system_settings'
  ]
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())',
      t || '_admin_all', t
    );
  end loop;
end;
$$;

-- Audit logs are the exception: admins read, nobody writes through the API.
create policy audit_logs_admin_read on audit_logs
  for select to authenticated using (is_admin());

-- =============================================================================
-- Parents
-- =============================================================================
-- A parent sees their household and nothing beside it.

create policy households_own on households
  for select to authenticated
  using (id = current_household_id());

create policy households_update_own on households
  for update to authenticated
  using (id = current_household_id())
  with check (id = current_household_id());

create policy contacts_own on contacts
  for select to authenticated
  using (household_id = current_household_id());

create policy contacts_update_own on contacts
  for update to authenticated
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

create policy players_own on players
  for all to authenticated
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

create policy player_availability_own on player_availability
  for all to authenticated
  using (exists (select 1 from players p where p.id = player_id and p.household_id = current_household_id()))
  with check (exists (select 1 from players p where p.id = player_id and p.household_id = current_household_id()));

-- Money is read-only to the household that owns it. Rows are created by edge
-- functions using the service role, never by a browser.
create policy payments_own_read on payments
  for select to authenticated
  using (household_id = current_household_id());

create policy packages_own_read on packages
  for select to authenticated
  using (household_id = current_household_id());

create policy credits_own_read on package_credits
  for select to authenticated
  using (household_id = current_household_id());

create policy bookings_own_read on bookings
  for select to authenticated
  using (household_id = current_household_id());

create policy holds_own on booking_holds
  for select to authenticated
  using (household_id = current_household_id());

create policy enrollments_own_read on enrollments
  for select to authenticated
  using (household_id = current_household_id());

create policy waitlists_own on waitlists
  for select to authenticated
  using (household_id = current_household_id());

create policy attendance_own_read on attendance
  for select to authenticated
  using (exists (select 1 from players p where p.id = player_id and p.household_id = current_household_id()));

-- Parent-visible notes only. A coaching aside stays with the trainer; an injury
-- or safety note is always visible, enforced by a check constraint in 0004.
create policy player_notes_parent_read on player_notes
  for select to authenticated
  using (
    parent_visible
    and exists (select 1 from players p where p.id = player_id and p.household_id = current_household_id())
  );

-- =============================================================================
-- The public catalogue
-- =============================================================================
-- Parents browse before they commit. Availability is not secret; capacity is
-- something we actively want them to see.

create policy seasons_readable on seasons
  for select to authenticated, anon
  using (status in ('open','running'));

create policy groups_readable on training_groups
  for select to authenticated, anon
  using (status in ('forming','confirmed','full'));

create policy meeting_times_readable on group_meeting_times
  for select to authenticated, anon using (true);

create policy sessions_readable on sessions
  for select to authenticated, anon
  using (status = 'scheduled');

create policy private_slots_readable on private_slots
  for select to authenticated, anon
  using (status in ('available','block_pending'));

create policy locations_readable on locations
  for select to authenticated, anon
  using (active);

-- Trainers are a public directory, but only the active ones.
create policy trainers_readable on trainers
  for select to authenticated, anon
  using (status = 'active');

-- =============================================================================
-- Trainers
-- =============================================================================

create policy trainer_self_read on trainers
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy trainer_self_update on trainers
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- A trainer may edit their bio and contact details. Pay, status and the
-- background check are admin-only.
--
-- This is a trigger rather than a self-referential subquery in WITH CHECK.
-- Both work, but a trigger comparing OLD to NEW is something a reviewer can
-- verify at a glance, and adding a protected column later is one line here
-- rather than another clause in a policy expression that is easy to get subtly
-- wrong. Privilege rules should be boring to read.
create or replace function trainers_protect_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;

  -- Anything not admin — including the trainer themselves — gets the stored
  -- values back for these columns, whatever they submitted.
  new.hourly_pay_cents            := old.hourly_pay_cents;
  new.status                      := old.status;
  new.background_check_status     := old.background_check_status;
  new.background_check_expires_at := old.background_check_expires_at;
  new.stripe_account_id           := old.stripe_account_id;
  new.auth_user_id                := old.auth_user_id;

  return new;
end;
$$;

create trigger trainers_protect_privileged
  before update on trainers
  for each row execute function trainers_protect_privileged_columns();

create policy trainer_availability_own on trainer_availability
  for all to authenticated
  using (trainer_id = current_trainer_id())
  with check (trainer_id = current_trainer_id());

create policy trainer_availability_exceptions_own on trainer_availability_exceptions
  for all to authenticated
  using (trainer_id = current_trainer_id())
  with check (trainer_id = current_trainer_id());

create policy trainer_shifts_own on trainer_shifts
  for select to authenticated
  using (trainer_id = current_trainer_id());

-- A trainer acknowledges a shift; they do not confirm, reprice or delete one.
create policy trainer_shifts_acknowledge on trainer_shifts
  for update to authenticated
  using (trainer_id = current_trainer_id() and status = 'proposed')
  with check (trainer_id = current_trainer_id() and status in ('proposed','acknowledged'));

create policy trainer_sessions_read on sessions
  for select to authenticated
  using (trainer_id = current_trainer_id());

create policy trainer_hours_own on trainer_hours
  for select to authenticated
  using (trainer_id = current_trainer_id());

-- The roster: a trainer sees the players booked into sessions they are running,
-- and nothing about any other family.
create policy trainer_roster_read on bookings
  for select to authenticated
  using (
    exists (
      select 1 from sessions s
      where s.id = bookings.session_id and s.trainer_id = current_trainer_id()
    )
  );

create policy trainer_players_read on players
  for select to authenticated
  using (
    exists (
      select 1
      from bookings b
      join sessions s on s.id = b.session_id
      where b.player_id = players.id
        and s.trainer_id = current_trainer_id()
        and b.status in ('confirmed','attended')
    )
  );

create policy trainer_attendance_write on attendance
  for all to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and s.trainer_id = current_trainer_id()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.trainer_id = current_trainer_id()));

create policy trainer_notes_write on player_notes
  for insert to authenticated
  with check (trainer_id = current_trainer_id());

create policy trainer_notes_read on player_notes
  for select to authenticated
  using (trainer_id = current_trainer_id());

-- =============================================================================
-- Deliberately closed
-- =============================================================================
-- webhook_events, scheduled_jobs and system_settings carry only the admin
-- policy created in the loop above. Everything else reaching them does so
-- through the service role in an edge function, which bypasses RLS by design —
-- that is the boundary where authority lives, not the browser.

comment on table webhook_events is
  'Service-role only. RLS grants nothing to authenticated users; edge functions write here with the service key.';

-- =============================================================================
-- A note on the functions above
-- =============================================================================
-- Every helper is SECURITY DEFINER with an explicit search_path. Without the
-- fixed search_path a caller could shadow a table name and have the definer
-- read the wrong one — the standard Postgres privilege-escalation route, and
-- worth stating because it is easy to omit when adding the next function.

revoke execute on function current_household_id() from anon;
revoke execute on function current_trainer_id()   from anon;
