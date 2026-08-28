-- =============================================================================
-- 0001 — Foundation: extensions, enums, settings, audit
-- =============================================================================
-- Everything downstream depends on the types and helpers declared here.
--
-- Two conventions hold across every migration:
--
--   1. Money is always `integer` cents, never numeric or float. A cent is the
--      smallest unit anyone is charged and rounding is decided explicitly, in
--      one place, rather than emerging from float arithmetic.
--
--   2. Every table that external systems can create rows in carries an
--      idempotency key with a unique index. Duplicate protection is a database
--      constraint, never an application check — an application check has a race
--      between the read and the write, and payment webhooks retry.
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive email
create extension if not exists "btree_gist";    -- exclusion constraints on ranges

-- =============================================================================
-- Enumerated states
-- =============================================================================
-- Enums rather than text + check: an invalid state becomes impossible to write
-- from any client, and the set is discoverable from the database itself.

create type group_status as enum (
  'draft',      -- being set up, not visible to parents
  'forming',    -- under 4 paid players
  'confirmed',  -- 4-5 paid, running, trainer committed
  'full',       -- 6 paid, waitlist only
  'completed',
  'canceled'
);

create type booking_status as enum (
  'held',             -- 15-minute hold, unpaid
  'payment_pending',  -- checkout started, awaiting Stripe
  'confirmed',        -- paid
  'attended',
  'canceled',
  'makeup_issued',
  'refunded',
  'no_show'
);

create type private_slot_status as enum (
  'available',      -- offered, nobody booked
  'held',
  'booked',         -- paid, but its block is not yet viable
  'block_pending',  -- waiting on a second session to make the trip worthwhile
  'confirmed',      -- block is viable; the trainer is committed
  'completed',
  'canceled'
);

create type shift_status as enum (
  'proposed',
  'acknowledged',
  'confirmed',
  'in_progress',
  'completed',
  'canceled'
);

create type attendance_state as enum (
  'present',
  'late',
  'absent',
  'excused',
  'canceled',
  'makeup'
);

create type session_kind as enum ('group', 'private');

create type credit_state as enum (
  'available',
  'reserved',   -- attached to a hold; released if the hold expires
  'consumed',
  'expired',
  'refunded'
);

create type payment_status as enum (
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded'
);

create type escalation_state as enum ('open', 'acknowledged', 'resolved', 'dismissed');

create type message_direction as enum ('inbound', 'outbound');

create type actor_kind as enum ('parent', 'trainer', 'admin', 'ai', 'system');

-- =============================================================================
-- System settings
-- =============================================================================
-- Every operational number the business might change lives here, not in code.
-- Seeded in 0009 with the values agreed for the first season.

create table system_settings (
  key          text primary key,
  value        jsonb not null,
  description  text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

comment on table system_settings is
  'Operational configuration. Prices, capacities and windows are read from here at runtime so they can change without a deploy.';

-- Read a numeric setting with a fallback, so a missing row degrades to a sane
-- default rather than a null propagating into a price.
create or replace function setting_int(p_key text, p_default integer)
returns integer
language sql
stable
as $$
  select coalesce((select (value #>> '{}')::integer from system_settings where key = p_key), p_default);
$$;

create or replace function setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
as $$
  select coalesce((select (value #>> '{}')::boolean from system_settings where key = p_key), p_default);
$$;

-- The global automation pause. Every scheduled job and every outbound message
-- checks this first. One switch, checked everywhere, so "stop the robots" is a
-- single action during an incident.
create or replace function automation_paused()
returns boolean
language sql
stable
as $$
  select setting_bool('automation_paused', false);
$$;

-- =============================================================================
-- Audit log
-- =============================================================================
-- Append-only. No update or delete policy is ever granted, on any role.

create table audit_logs (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  actor_kind    actor_kind not null,
  actor_id      uuid,                    -- auth.users id, or null for system/ai
  action        text not null,           -- 'booking.confirmed', 'credit.consumed'
  subject_table text not null,
  subject_id    uuid,
  before        jsonb,
  after         jsonb,
  context       jsonb not null default '{}'::jsonb
);

create index audit_logs_subject_idx on audit_logs (subject_table, subject_id, occurred_at desc);
create index audit_logs_action_idx   on audit_logs (action, occurred_at desc);

comment on table audit_logs is
  'Immutable record of every consequential change. Written by triggers and by functions; never updated or deleted.';

create or replace function write_audit(
  p_actor_kind    actor_kind,
  p_actor_id      uuid,
  p_action        text,
  p_subject_table text,
  p_subject_id    uuid,
  p_before        jsonb default null,
  p_after         jsonb default null,
  p_context       jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_logs (actor_kind, actor_id, action, subject_table, subject_id, before, after, context)
  values (p_actor_kind, p_actor_id, p_action, p_subject_table, p_subject_id, p_before, p_after, p_context);
$$;

-- =============================================================================
-- Webhook events — the idempotency spine
-- =============================================================================
-- Stripe, Quo and HubSpot all retry. Every inbound event claims a row here
-- before it is processed; the unique constraint is what makes "process once"
-- true under concurrency rather than merely likely.

create table webhook_events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,            -- 'stripe' | 'quo' | 'hubspot' | 'wordpress'
  external_id   text not null,            -- the provider's own event id
  event_type    text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  failed_at     timestamptz,
  attempts      integer not null default 0,
  last_error    text,
  unique (source, external_id)
);

create index webhook_events_unprocessed_idx
  on webhook_events (source, received_at)
  where processed_at is null;

comment on column webhook_events.external_id is
  'The provider event id. The unique index on (source, external_id) is the only thing standing between a retry and a double charge.';

-- Claim an event for processing. Returns true exactly once per event, however
-- many times the provider sends it or however many workers race.
create or replace function claim_webhook_event(
  p_source      text,
  p_external_id text,
  p_event_type  text,
  p_payload     jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into webhook_events (source, external_id, event_type, payload)
  values (p_source, p_external_id, p_event_type, p_payload)
  on conflict (source, external_id) do nothing;

  get diagnostics v_inserted = row_count;

  return v_inserted = 1;
end;
$$;

-- =============================================================================
-- Scheduled jobs
-- =============================================================================
-- A record of what ran and when, so a missed tier is visible rather than silent.

create table scheduled_jobs (
  id            uuid primary key default gen_random_uuid(),
  job_key       text not null,          -- 'expire_holds' | 'promote_waitlists'
  tier          text not null,          -- 'five_minute' | 'hourly' | 'daily' | 'weekly'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  succeeded     boolean,
  items_processed integer not null default 0,
  detail        jsonb not null default '{}'::jsonb,
  error         text
);

create index scheduled_jobs_key_idx on scheduled_jobs (job_key, started_at desc);

-- =============================================================================
-- Escalations — anything a human must look at
-- =============================================================================

create table escalations (
  id            uuid primary key default gen_random_uuid(),
  raised_at     timestamptz not null default now(),
  source        text not null,          -- 'ai' | 'payment' | 'scheduling' | 'safety'
  severity      text not null default 'normal',   -- 'low' | 'normal' | 'urgent'
  summary       text not null,
  detail        jsonb not null default '{}'::jsonb,
  subject_table text,
  subject_id    uuid,
  state         escalation_state not null default 'open',
  resolved_at   timestamptz,
  resolved_by   uuid,
  resolution    text
);

create index escalations_open_idx on escalations (severity, raised_at desc) where state = 'open';

comment on table escalations is
  'The queue a human owns. The AI agent writes here rather than guessing on anything sensitive, disputed, safety-related or policy-conflicting.';

-- =============================================================================
-- updated_at maintenance
-- =============================================================================

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
