-- =============================================================================
-- 0008 — Conversations, messages, interaction notes
-- =============================================================================
-- The AI agent's memory. Every exchange is recorded with enough structure that
-- a human picking up a thread can see what was said, what the agent understood,
-- and what it decided to do — without reading the whole history.
--
-- The agent writes here; it does not decide policy. Anything sensitive,
-- disputed, safety-related or refund-related becomes an escalation instead.
-- =============================================================================

create table conversations (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid references households (id) on delete set null,
  contact_id     uuid references contacts (id) on delete set null,

  channel        text not null default 'sms' check (channel in ('sms','email','portal','call')),
  phone_number   text,                    -- E.164, the Quo thread key

  -- Quo's own conversation id, so an inbound webhook lands on the right thread
  -- rather than opening a new one.
  external_id    text unique,

  state          text not null default 'open'
                   check (state in ('open','waiting_on_parent','waiting_on_us','closed')),

  -- Set when a human takes over. While true, the agent stays silent on this
  -- thread — a person and a robot answering the same parent is worse than
  -- either alone.
  human_owned    boolean not null default false,
  owned_by       uuid,

  last_message_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index conversations_household_idx on conversations (household_id, last_message_at desc);
create index conversations_phone_idx on conversations (phone_number);
create index conversations_open_idx on conversations (state, last_message_at desc)
  where state <> 'closed';

create trigger conversations_touch before update on conversations
  for each row execute function touch_updated_at();

comment on column conversations.human_owned is
  'While true the agent does not reply on this thread. A person and a bot answering the same parent is worse than either alone.';

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,

  direction       message_direction not null,
  sender_kind     actor_kind not null,
  sender_id       uuid,

  body            text not null,

  -- What the agent made of it. Null on outbound and on messages processed
  -- before the classifier ran.
  intent          text,
  sentiment       text check (sentiment in ('positive','neutral','negative','urgent')),
  recommended_action text,
  follow_up_on    date,

  -- What this message was about, when it can be tied to something concrete.
  booking_id      uuid references bookings (id) on delete set null,
  payment_id      uuid references payments (id) on delete set null,
  group_id        uuid references training_groups (id) on delete set null,

  -- Quo's message id. Unique, so a redelivered webhook does not duplicate a
  -- message into the thread.
  external_id     text unique,

  -- Outbound de-duplication. A hash of (conversation, template, subject) so the
  -- same reminder cannot be sent twice by two overlapping jobs.
  dedupe_key      text,

  delivered_at    timestamptz,
  failed_at       timestamptz,
  error           text,

  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_followup_idx on messages (follow_up_on) where follow_up_on is not null;
create unique index messages_dedupe_key on messages (dedupe_key) where dedupe_key is not null;

comment on column messages.dedupe_key is
  'Set on every automated outbound message. The unique index is what makes "never send the same reminder twice" a database guarantee rather than a hope.';

-- Structured takeaways, separate from the message text. A note survives even
-- when the conversation is long and nobody will re-read it.
create table interaction_notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations (id) on delete cascade,
  household_id    uuid references households (id) on delete cascade,
  player_id       uuid references players (id) on delete set null,

  summary         text not null,
  detail          jsonb not null default '{}'::jsonb,
  written_by      actor_kind not null default 'ai',

  created_at      timestamptz not null default now()
);

create index interaction_notes_household_idx on interaction_notes (household_id, created_at desc);

-- =============================================================================
-- Sending, safely
-- =============================================================================
-- One function owns every outbound message. It checks the pause switch, refuses
-- to talk over a human, and claims a dedupe key — so no caller can bypass any
-- of those by forgetting.

create or replace function queue_outbound_message(
  p_conversation_id uuid,
  p_body            text,
  p_dedupe_key      text default null,
  p_sender_kind     actor_kind default 'ai',
  p_context         jsonb default '{}'::jsonb
)
returns messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv messages%rowtype;
  v_row  messages%rowtype;
  v_human boolean;
begin
  if automation_paused() and p_sender_kind = 'ai' then
    raise exception 'Automation is paused' using errcode = 'check_violation';
  end if;

  select human_owned into v_human from conversations where id = p_conversation_id;

  if v_human and p_sender_kind = 'ai' then
    raise exception 'A human owns this conversation' using errcode = 'check_violation';
  end if;

  insert into messages (conversation_id, direction, sender_kind, body, dedupe_key,
                        booking_id, payment_id, group_id)
  values (
    p_conversation_id, 'outbound', p_sender_kind, p_body, p_dedupe_key,
    (p_context ->> 'booking_id')::uuid,
    (p_context ->> 'payment_id')::uuid,
    (p_context ->> 'group_id')::uuid
  )
  -- The index is partial (dedupe_key is not null), and Postgres will only use
  -- it for inference if the predicate is repeated here. Without this the clause
  -- raises rather than de-duplicating — which is the whole point of it.
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning * into v_row;

  -- Nothing inserted means the dedupe key was already used: this exact message
  -- has been sent. Return the original rather than raising, so a retrying job
  -- sees success.
  if v_row.id is null and p_dedupe_key is not null then
    select * into v_row from messages where dedupe_key = p_dedupe_key;
  end if;

  update conversations set last_message_at = now(), state = 'waiting_on_parent'
  where id = p_conversation_id;

  return v_row;
end;
$$;

comment on function queue_outbound_message is
  'The only way to send. Enforces the pause switch, refuses to talk over a human, and de-duplicates — none of which a caller can skip.';

-- =============================================================================
-- Escalate rather than guess
-- =============================================================================

create or replace function escalate(
  p_source   text,
  p_summary  text,
  p_severity text default 'normal',
  p_subject_table text default null,
  p_subject_id uuid default null,
  p_detail   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into escalations (source, severity, summary, detail, subject_table, subject_id)
  values (p_source, p_severity, p_summary, p_detail, p_subject_table, p_subject_id)
  returning id into v_id;

  perform write_audit('ai', null, 'escalation.raised', 'escalations', v_id,
                      null, jsonb_build_object('summary', p_summary, 'severity', p_severity));

  return v_id;
end;
$$;

-- =============================================================================
-- RLS for messaging
-- =============================================================================

alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table interaction_notes enable row level security;

create policy conversations_admin on conversations
  for all to authenticated using (is_admin()) with check (is_admin());

create policy messages_admin on messages
  for all to authenticated using (is_admin()) with check (is_admin());

create policy interaction_notes_admin on interaction_notes
  for all to authenticated using (is_admin()) with check (is_admin());

-- A parent reads their own thread and can add to it.
create policy conversations_own on conversations
  for select to authenticated
  using (household_id = current_household_id());

create policy messages_own_read on messages
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = conversation_id and c.household_id = current_household_id()
  ));

create policy messages_own_write on messages
  for insert to authenticated
  with check (
    direction = 'inbound'
    and sender_kind = 'parent'
    and exists (
      select 1 from conversations c
      where c.id = conversation_id and c.household_id = current_household_id()
    )
  );

-- Interaction notes are internal. Parents do not read them.
