-- =============================================================================
-- 0017 — Execute privileges, and the anonymous hole
-- =============================================================================
-- An audit of 0001–0016 found the same defect twice, and it is worth writing
-- down plainly because the rest of this directory reads as though it were not
-- true.
--
--   1. PostgreSQL grants EXECUTE on a new function to PUBLIC. Nothing in the
--      earlier migrations revoked it. So every SECURITY DEFINER function — the
--      ones that settle payments, issue credits and commit trainers — was
--      callable by anyone holding the anon key, through PostgREST's /rpc.
--
--   2. Every assert_* guard opened with `if auth.uid() is null then return`,
--      meaning "there is no end user, so this must be a job or a webhook".
--      An anonymous caller has no auth.uid() either. The guard waved them
--      through.
--
--      0016 tried to close part of this with `revoke ... from anon`. That does
--      nothing while PUBLIC still holds the grant.
--
-- Both are fixed here, together, because either alone leaves the door open.
-- The rule from now on: nothing is callable unless this file says who may call
-- it, and "no signed-in user" means the service role or nobody.
-- =============================================================================

-- =============================================================================
-- Who is calling, properly
-- =============================================================================

create or replace function acting_as_service()
returns boolean
language sql
stable
as $$
  -- The role claim, not the database role. Inside a SECURITY DEFINER function
  -- current_user is the function's *owner*, so a check on current_user returns
  -- true for every definer call — which is precisely the mistake that made the
  -- first version of this function useless.
  --
  -- PostgREST always presents a JWT, even for an anonymous visitor: Supabase's
  -- publishable key is itself a token with role=anon. So a request that
  -- carries no claims at all did not come through the API — it is a migration,
  -- a scheduled statement, or someone at a psql prompt.
  select case coalesce(auth.jwt() ->> 'role', '')
    when 'service_role' then true
    when 'authenticated' then false
    when 'anon' then false
    else session_user in ('postgres', 'supabase_admin', 'service_role')
  end;
$$;

comment on function acting_as_service is
  'True only inside the trust boundary: the service role, or a superuser running maintenance. An anonymous PostgREST caller is neither, which is the distinction 0007 got wrong.';

-- The guards, rewritten. The difference is one line each, and it is the line
-- that matters: no signed-in user is now a refusal rather than a pass.
create or replace function assert_household_access(p_household_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if acting_as_service() then return; end if;
  if is_admin() then return; end if;

  if auth.uid() is null then
    raise exception 'Sign in to do that' using errcode = 'insufficient_privilege';
  end if;

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
  if acting_as_service() then return; end if;
  if is_admin() then return; end if;

  if auth.uid() is null then
    raise exception 'Sign in to do that' using errcode = 'insufficient_privilege';
  end if;

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
  if acting_as_service() then return; end if;
  if is_admin() then return; end if;

  if auth.uid() is null then
    raise exception 'Sign in to do that' using errcode = 'insufficient_privilege';
  end if;

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

-- Used by the functions that only staff may call at all.
create or replace function assert_staff()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if acting_as_service() or is_admin() then return; end if;

  raise exception 'That is an administrator action'
    using errcode = 'insufficient_privilege';
end;
$$;

-- =============================================================================
-- Take everything back
-- =============================================================================
-- Revoked from PUBLIC, not from anon: revoking from a role that never held the
-- grant is what 0016 did, and it changed nothing.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature,
           p.prosecdef,
           p.provolatile,
           p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public', fn.signature);
    execute format('revoke all on function %s from anon, authenticated', fn.signature);

    -- The service role keeps everything. It is the trust boundary, and it is
    -- reached only from an edge function holding a key that never leaves the
    -- server.
    execute format('grant execute on function %s to postgres', fn.signature);

    -- Two categories go back to everyone, because withholding them breaks the
    -- database without protecting anything:
    --
    --   Trigger functions, which Postgres checks against whoever ran the
    --   INSERT or UPDATE. A parent updating their own row must be allowed to
    --   fire the trigger that guards it.
    --
    --   Read-only, non-definer helpers — setting_int(), is_admin(),
    --   miles_between(). They run as the caller, so RLS still applies to
    --   anything they read, and they carry no authority of their own. They are
    --   also called from inside the definer functions, where a missing grant
    --   fails the whole call.
    if fn.is_trigger or (not fn.prosecdef and fn.provolatile in ('i', 's')) then
      execute format('grant execute on function %s to anon, authenticated', fn.signature);
    end if;
  end loop;
end;
$$;

-- Supabase creates service_role; a bare Postgres used for verification may
-- not have it. Grant where it exists.
do $$
declare
  fn record;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for fn in
      select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    loop
      execute format('grant execute on function %s to service_role', fn.signature);
    end loop;
  end if;
end;
$$;

-- Default privileges for anything added later, so the next migration does not
-- reopen the hole by existing.
alter default privileges in schema public revoke execute on functions from public;

-- =============================================================================
-- Give back exactly what the browser needs
-- =============================================================================
-- Two lists, and the reason each entry is on one is written beside it. If a
-- function is not here, a browser cannot call it — which is the intended
-- default rather than an oversight.

-- Anonymous: the public catalogue, and nothing that touches a family.
grant execute on function camps_near(text, numeric, text, text, smallint, camp_day_option, date, date) to anon, authenticated;
grant execute on function camp_occupancy(uuid)   to anon, authenticated;   -- how full is this week
grant execute on function group_occupancy(uuid)  to anon, authenticated;   -- how close is this group
grant execute on function session_occupancy(uuid) to anon, authenticated;
grant execute on function offerable_private_slots_all(date, date) to anon, authenticated;
grant execute on function miles_between(numeric, numeric, numeric, numeric) to anon, authenticated;
grant execute on function setting_int(text, integer)  to anon, authenticated;
grant execute on function setting_bool(text, boolean) to anon, authenticated;
grant execute on function setting_text(text, text)    to anon, authenticated;

-- The identity helpers. Every RLS policy calls these, and a policy runs as the
-- caller — so without the grant, row-level security itself fails closed with a
-- permission error rather than an empty result. They are safe to hand out:
-- each returns only the caller's own id, derived from auth.uid().
grant execute on function current_household_id() to authenticated;
grant execute on function current_trainer_id()   to authenticated;

-- Signed in: the things a parent or a trainer does for themselves. Every one
-- of these asserts household or trainer access in its own body.
grant execute on function begin_checkout(text, uuid, uuid, text) to authenticated;
grant execute on function begin_camp_registration(uuid, uuid, camp_day_option, text, uuid[], jsonb) to authenticated;
grant execute on function book_with_credit(uuid, uuid)           to authenticated;
grant execute on function cancel_booking(uuid, boolean, text)    to authenticated;
grant execute on function cancel_camp_registration(uuid, boolean, text) to authenticated;
grant execute on function create_booking_hold(uuid, uuid, boolean) to authenticated;
grant execute on function create_camp_hold(uuid, uuid, camp_day_option) to authenticated;
grant execute on function join_waitlist(uuid, uuid)              to authenticated;
grant execute on function join_camp_waitlist(uuid, uuid)         to authenticated;
grant execute on function accept_waitlist_invite(uuid, text)     to authenticated;
grant execute on function decline_waitlist_invite(uuid)          to authenticated;
grant execute on function record_attendance(uuid, uuid, attendance_state, text) to authenticated;
grant execute on function record_camp_attendance(uuid, uuid, attendance_state, text) to authenticated;
grant execute on function player_is_eligible(uuid, uuid)         to authenticated;
grant execute on function camp_age_ok(uuid, uuid)                to authenticated;
grant execute on function camp_has_space(uuid)                   to anon, authenticated;
grant execute on function group_has_space(uuid)                  to anon, authenticated;
grant execute on function price_camp(uuid, camp_day_option, uuid[]) to anon, authenticated;
grant execute on function price_group_package(uuid)              to anon, authenticated;
grant execute on function price_group_dropin(uuid)               to anon, authenticated;
grant execute on function price_private_slot(uuid)               to anon, authenticated;

-- Deliberately NOT granted to anyone but the service role, with the reason:
--
--   settle_checkout          creates places from money. Called by the Stripe
--                            webhook, which is the only thing that knows a
--                            payment is real.
--   attach_payment_intent    binds a checkout to a Stripe id.
--   confirm_booking          the only path into 'confirmed'.
--   settle_camp_checkout     the same, for camps.
--   issue_makeup_credit      mints money.
--   record_refund            moves money back.
--   record_trainer_hours     books payroll.
--   override_confirm_block   commits a trainer against the block rule.
--   write_audit              the record has to be one nobody can forge.
--   claim/complete/release_webhook_event
--                            claiming an event id nobody has sent yet would
--                            make the real delivery look like a duplicate.
--   run_scheduled_job, run_tier, and every job body.
--   recompute_group_status, recompute_camp_status, expire_* , promote_*.

-- =============================================================================
-- Staff-only functions now say so in their own bodies
-- =============================================================================
-- Belt and braces: the grants above are the fence, and these are the lock. A
-- future migration that grants something back by accident still cannot be used
-- by a parent.

create or replace function assert_service_only(p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if acting_as_service() then return; end if;

  raise exception '% is not something a client may call', p_what
    using errcode = 'insufficient_privilege';
end;
$$;

grant execute on function acting_as_service() to authenticated;
