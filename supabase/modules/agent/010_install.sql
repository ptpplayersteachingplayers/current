-- =============================================================================
-- Module: agent — 010 install
-- =============================================================================
-- The AI operations agent. The platform underneath it already knows who a
-- phone number belongs to, what that family consented to receive, and how to
-- queue a message (migration 0019). What this module adds is the part that is
-- actually the agent:
--
--   * agent_context()            — one read, shaped for a language model
--   * agent_options_for_player() — what may honestly be offered to this child
--   * must_escalate()            — the phrases a model never gets to answer
--   * scheduled_followups        — chasing, and the rules for not chasing
--
-- Three rules shape it.
--
--   1. The agent does not remember; it asks. Before recommending or booking
--      anything it queries current state. A model's recollection of how many
--      places were left twenty minutes ago is not a fact about the world.
--
--   2. Its tools are the same functions a parent's browser calls, with the
--      same guards. There is no privileged shortcut, so a jailbroken prompt
--      cannot reach further than a jailbroken browser could.
--
--   3. Everything it cannot do is written down here rather than in a prompt.
--      A prompt is a request; a grant is a fact.
--
-- Apply after every core migration. Uninstall with 999_uninstall.sql.
-- =============================================================================

do $mod$ begin
  perform register_module(
    'agent',
    '1.0.0',
    'SMS and email agent: identity-aware follow-up, recommendations, booking, and HubSpot sync.');
end $mod$;

-- What the agent is allowed to know
-- =============================================================================
-- One read, shaped for a language model: who this is, what they have, and what
-- is currently available to them. The agent calls this before every
-- recommendation, which is the mechanism behind "it does not rely on memory".

create or replace function agent_context(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conv      conversations%rowtype;
  v_household uuid;
begin
  perform assert_service_only('Reading agent context');

  select * into v_conv from conversations where id = p_conversation_id;
  if not found then
    raise exception 'Unknown conversation' using errcode = 'no_data_found';
  end if;

  v_household := v_conv.household_id;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_conv.id,
      'channel', v_conv.channel,
      'state', v_conv.agent_state,
      'human_owned', v_conv.human_owned
    ),

    'contact', (
      select jsonb_build_object(
        'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
        'sms_consent', c.sms_consent, 'email_consent', c.email_consent,
        'may_text_now', may_contact(c.id, 'sms'))
      from contacts c where c.id = v_conv.contact_id),

    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'birth_date', p.birth_date,
        'age', case when p.birth_date is null then null
                    else extract(year from age(p.birth_date))::int end,
        'skill_level', p.skill_level, 'club_team', p.club_team))
      from players p where p.household_id = v_household), '[]'::jsonb),

    'credits_available', coalesce((
      select count(*) from package_credits
      where household_id = v_household and state = 'available'), 0),

    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', b.id, 'player', pl.first_name,
        'starts_at', s.starts_at, 'group', g.name))
      from bookings b
      join sessions s on s.id = b.session_id
      join players pl on pl.id = b.player_id
      left join training_groups g on g.id = s.group_id
      where b.household_id = v_household and b.status = 'confirmed'
        and s.starts_at > now()), '[]'::jsonb),

    'camp_registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'camp', c.name, 'starts_on', c.starts_on, 'status', r.status))
      from camp_registrations r join camps c on c.id = r.camp_id
      where r.household_id = v_household and r.status in ('confirmed','attended')), '[]'::jsonb),

    'open_holds', coalesce((
      select jsonb_agg(jsonb_build_object('session_id', h.session_id, 'expires_at', h.expires_at))
      from booking_holds h where h.household_id = v_household and h.expires_at > now()), '[]'::jsonb),

    -- The pause switch, so the agent knows to stay quiet rather than
    -- discovering it when a send is refused.
    'automation_paused', automation_paused()
  );
end;
$$;

comment on function agent_context is
  'Everything the agent may know about a family, in one read. It is called before every recommendation — a model''s recollection of how many places were left twenty minutes ago is not a fact about the world.';

-- What can this player actually be offered? The eligibility rules already
-- exist; this shapes them for the agent so it cannot offer a group the
-- checkout would then refuse.
create or replace function agent_options_for_player(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_service_only('Reading agent options');

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'status', g.status,
        'paid', o.paid, 'capacity', o.capacity,
        'spots_left', greatest(0, o.capacity - o.total),
        'needs_to_start', greatest(0, g.min_players - o.paid),
        'location', l.name))
      from training_groups g
      cross join lateral group_occupancy(g.id) o
      left join locations l on l.id = g.location_id
      where g.status in ('forming','confirmed','full')
        and player_is_eligible(p_player_id, g.id)), '[]'::jsonb),

    'camps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'city', c.city, 'state', c.state,
        'starts_on', c.starts_on, 'ends_on', c.ends_on,
        'status', c.status, 'spots_left', greatest(0, o.capacity - o.total),
        'full_day_price_cents', c.full_day_price_cents))
      from camps c
      cross join lateral camp_occupancy(c.id) o
      where c.status in ('registration_open','limited','full','waitlist')
        and camp_age_ok(c.id, p_player_id)), '[]'::jsonb),

    'private_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot_id', s.slot_id, 'trainer', s.trainer_name,
        'starts_at', s.starts_at, 'price_cents', s.price_cents,
        'joins_existing_work', s.joins_existing_work))
      from offerable_private_slots_all() s
      limit 10), '[]'::jsonb)
  );
end;
$$;

-- =============================================================================
-- Follow-ups
-- =============================================================================

create table scheduled_followups (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households (id) on delete cascade,
  contact_id    uuid references contacts (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,

  reason        text not null,
  due_at        timestamptz not null,
  channel       text not null default 'sms',

  -- What this follow-up is about, so a job can check whether it is still
  -- worth sending before it sends it.
  subject_table text,
  subject_id    uuid,

  state         text not null default 'pending'
                  check (state in ('pending','sent','skipped','canceled')),
  sent_at       timestamptz,
  skipped_reason text,

  -- One follow-up per household per reason per subject. The unique index is
  -- what stops two jobs, or one job run twice, texting the same family twice.
  dedupe_key    text not null unique,

  created_at    timestamptz not null default now()
);

create index scheduled_followups_due_idx on scheduled_followups (due_at)
  where state = 'pending';

create or replace function schedule_followup(
  p_household_id uuid,
  p_reason       text,
  p_due_at       timestamptz,
  p_subject_table text default null,
  p_subject_id   uuid default null,
  p_channel      text default 'sms',
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_key text;
  v_contact uuid;
begin
  perform assert_service_only('Scheduling a follow-up');

  v_key := format('%s:%s:%s', p_household_id, p_reason, coalesce(p_subject_id::text, 'none'));

  select id into v_contact from contacts
  where household_id = p_household_id and is_primary limit 1;

  insert into scheduled_followups (household_id, contact_id, conversation_id, reason,
                                   due_at, channel, subject_table, subject_id, dedupe_key)
  values (p_household_id, v_contact, p_conversation_id, p_reason,
          p_due_at, p_channel, p_subject_table, p_subject_id, v_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function must_escalate(p_body text)
returns text
language sql
immutable
as $$
  select case
    when p_body ~* '\y(hurt|injur|concussion|head|ambulance|hospital|bleeding|broke)\y' then 'safety'
    when p_body ~* '\y(lawyer|attorney|sue|legal|liabilit|negligen)\y' then 'legal'
    when p_body ~* '\y(refund|chargeback|dispute|charged twice|double charged|money back)\y' then 'refund'
    when p_body ~* '\y(waiver|insurance|medical form)\y' then 'paperwork'
    when p_body ~* '\y(complain|unacceptable|furious|disgrace|terrible)\y' then 'unhappy'
    else null
  end;
$$;

comment on function must_escalate is
  'A pattern match, not a judgement. An injury or a chargeback goes to a person whether or not the model recognises it as serious — the escalation must not depend on the thing being escalated about.';


-- =============================================================================
-- RLS and grants
-- =============================================================================
-- scheduled_followups is operational: a family reading their own follow-up
-- schedule would be reading our sales notes about them.

alter table scheduled_followups enable row level security;

create policy scheduled_followups_admin on scheduled_followups
  for all to authenticated using (is_admin()) with check (is_admin());

-- Every function above is service-role only. The agent reaches them through an
-- edge function holding a key that never leaves the server; a browser cannot
-- call any of them, and neither can a prompt.
revoke all on function agent_context(uuid) from public, anon, authenticated;
revoke all on function agent_options_for_player(uuid) from public, anon, authenticated;
revoke all on function schedule_followup(uuid, text, timestamptz, text, uuid, text, uuid)
  from public, anon, authenticated;

-- Pure, and carries no data, so it is safe anywhere.
grant execute on function must_escalate(text) to anon, authenticated;
