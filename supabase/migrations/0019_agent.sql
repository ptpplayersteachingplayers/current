-- =============================================================================
-- 0019 — The AI operations agent
-- =============================================================================
-- The agent answers parents by SMS and email, and books them in. What follows
-- is the part of it that lives in the database, which is deliberately most of
-- it: identity matching, consent, the tools it may call, and the line past
-- which it must hand over to a person.
--
-- Three rules shape this file.
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
-- =============================================================================

create type conversation_state as enum (
  'new_inquiry',
  'collecting_player_info',
  'collecting_availability',
  'recommending',
  'awaiting_selection',
  'hold_created',
  'payment_pending',
  'booked',
  'waitlisted',
  'follow_up_required',
  'escalated',
  'closed'
);

-- =============================================================================
-- Identity
-- =============================================================================
-- The single largest source of mess in the old platform was the same family
-- existing three times: once from a camp registration, once from a phone
-- number, once from a form. Matching happens here, on normalised keys, with a
-- unique index doing the work rather than a lookup the agent might skip.

create table contact_identities (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts (id) on delete cascade,

  kind          text not null check (kind in ('phone','email','hubspot','quo','wordpress','stripe')),
  -- Normalised: E.164 for phones, lowercased for email. The raw value is kept
  -- so a person can see what actually arrived.
  value         text not null,
  raw_value     text not null default '',

  verified_at   timestamptz,
  created_at    timestamptz not null default now(),

  unique (kind, value)
);

create index contact_identities_contact_idx on contact_identities (contact_id);

comment on table contact_identities is
  'Every way we know a person. The unique index on (kind, value) is what makes "find or create" safe under concurrency — two inbound messages from the same number at the same moment cannot make two households.';

-- Digits only, then +1 for a ten-digit North American number. Deliberately
-- narrow: a number this cannot normalise is stored as it arrived and matched
-- exactly, rather than guessed at.
create or replace function normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when p_phone is null or p_phone = '' then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 10
      then '+1' || regexp_replace(p_phone, '\D', '', 'g')
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 11
         and left(regexp_replace(p_phone, '\D', '', 'g'), 1) = '1'
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    when left(p_phone, 1) = '+' then p_phone
    else regexp_replace(p_phone, '\s', '', 'g')
  end;
$$;

create or replace function find_contact(p_phone text default null, p_email text default null)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select contact_id from contact_identities
      where kind = 'phone' and value = normalize_phone(p_phone) limit 1),
    (select contact_id from contact_identities
      where kind = 'email' and value = lower(trim(p_email)) limit 1),
    (select id from contacts where phone = normalize_phone(p_phone) limit 1),
    (select id from contacts where email = lower(trim(p_email))::citext limit 1)
  );
$$;

-- The only way the agent creates a person. Returns the existing contact when
-- either identifier already matches, so an inbound text from a family we know
-- by email joins their record rather than starting a second one.
create or replace function find_or_create_contact(
  p_phone      text default null,
  p_email      text default null,
  p_first_name text default '',
  p_last_name  text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact   uuid;
  v_household uuid;
  v_phone     text := normalize_phone(p_phone);
  v_email     text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  perform assert_service_only('Creating a contact');

  if v_phone is null and v_email is null then
    raise exception 'A contact needs a phone number or an email address'
      using errcode = 'check_violation';
  end if;

  v_contact := find_contact(v_phone, v_email);

  if v_contact is not null then
    -- Learn the identifier we did not have. This is how a family known by
    -- email becomes reachable by text without becoming two families.
    if v_phone is not null then
      insert into contact_identities (contact_id, kind, value, raw_value)
      values (v_contact, 'phone', v_phone, coalesce(p_phone, ''))
      on conflict (kind, value) do nothing;

      update contacts set phone = coalesce(phone, v_phone) where id = v_contact;
    end if;

    if v_email is not null then
      insert into contact_identities (contact_id, kind, value, raw_value)
      values (v_contact, 'email', v_email, coalesce(p_email, ''))
      on conflict (kind, value) do nothing;

      update contacts set email = coalesce(email, v_email::citext) where id = v_contact;
    end if;

    return v_contact;
  end if;

  insert into households (display_name)
  values (nullif(trim(coalesce(p_last_name, '') || ' family'), ' family'))
  returning id into v_household;

  insert into contacts (household_id, first_name, last_name, email, phone, is_primary)
  values (v_household, coalesce(p_first_name, ''), coalesce(p_last_name, ''),
          v_email::citext, v_phone, true)
  returning id into v_contact;

  if v_phone is not null then
    insert into contact_identities (contact_id, kind, value, raw_value)
    values (v_contact, 'phone', v_phone, coalesce(p_phone, ''))
    on conflict (kind, value) do nothing;
  end if;

  if v_email is not null then
    insert into contact_identities (contact_id, kind, value, raw_value)
    values (v_contact, 'email', v_email, coalesce(p_email, ''))
    on conflict (kind, value) do nothing;
  end if;

  perform write_audit('ai', null, 'contact.created', 'contacts', v_contact,
                      null, jsonb_build_object('phone', v_phone, 'email', v_email));

  return v_contact;
end;
$$;

-- Which parent goes with which child, when a household has more than one of
-- either. The agent uses it to address the right person about the right child.
create table parent_player_relationships (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  relationship  text not null default 'parent'
                  check (relationship in ('parent','guardian','grandparent','other')),
  is_primary    boolean not null default true,
  can_collect   boolean not null default true,
  created_at    timestamptz not null default now(),

  unique (contact_id, player_id)
);

-- =============================================================================
-- Consent
-- =============================================================================
-- Not a flag on a message: a state of the person, checked before every send,
-- with the moment it changed recorded. STOP has to work the first time.

alter table contacts
  add column sms_consent        boolean not null default false,
  add column sms_consent_at     timestamptz,
  add column email_consent      boolean not null default false,
  add column email_consent_at   timestamptz,
  add column unsubscribed_at    timestamptz,
  add column preferred_channel  text not null default 'sms'
                                  check (preferred_channel in ('sms','email','none'));

comment on column contacts.sms_consent is
  'Checked before every outbound message, not recorded after. A family who has said stop is unreachable by the agent until they say otherwise.';

create or replace function record_consent(
  p_contact_id uuid,
  p_channel    text,
  p_granted    boolean,
  p_source     text default 'sms'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_service_only('Recording consent');

  if p_channel = 'sms' then
    update contacts
    set sms_consent = p_granted,
        sms_consent_at = now(),
        unsubscribed_at = case when p_granted then null else now() end
    where id = p_contact_id;
  elsif p_channel = 'email' then
    update contacts
    set email_consent = p_granted,
        email_consent_at = now(),
        unsubscribed_at = case when p_granted then unsubscribed_at else now() end
    where id = p_contact_id;
  elsif p_channel = 'all' then
    update contacts
    set sms_consent = p_granted, email_consent = p_granted,
        sms_consent_at = now(), email_consent_at = now(),
        unsubscribed_at = case when p_granted then null else now() end,
        preferred_channel = case when p_granted then preferred_channel else 'none' end
    where id = p_contact_id;
  end if;

  perform write_audit('system', null,
                      case when p_granted then 'consent.granted' else 'consent.withdrawn' end,
                      'contacts', p_contact_id,
                      null, jsonb_build_object('channel', p_channel, 'source', p_source));
end;
$$;

-- May we send to this person, on this channel, at this moment? One function,
-- so no caller can forget one of the three questions.
drop function if exists may_contact(uuid, text);

create or replace function may_contact(
  p_contact_id uuid,
  p_channel text default 'sms',
  p_transactional boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_contact contacts%rowtype;
  v_hour    integer;
  v_from    integer := setting_int('quiet_hours_start', 21);
  v_to      integer := setting_int('quiet_hours_end', 8);
begin
  select * into v_contact from contacts where id = p_contact_id;
  if not found then return false; end if;

  if v_contact.unsubscribed_at is not null then return false; end if;

  if p_channel = 'sms' and not v_contact.sms_consent then return false; end if;
  if p_channel = 'email' and not v_contact.email_consent then return false; end if;

  -- Quiet hours apply to the agent chasing people, not to a reminder about a
  -- session a family has already paid for. Both distinctions are the same one:
  -- a message they asked for by booking, versus a message we decided to send.
  if p_transactional then
    return true;
  end if;

  -- In the family's own timezone rather than the server's. A text about
  -- Thursday's session at half past two in the morning loses a customer.
  v_hour := extract(hour from (now() at time zone setting_text('display_timezone', 'America/New_York')));

  if v_from > v_to then
    -- The window crosses midnight: 21:00 to 08:00.
    if v_hour >= v_from or v_hour < v_to then return false; end if;
  else
    if v_hour >= v_from and v_hour < v_to then return false; end if;
  end if;

  return true;
end;
$$;

-- =============================================================================
-- Conversations, with a state the agent must move through
-- =============================================================================

alter table conversations
  add column agent_state conversation_state not null default 'new_inquiry',
  add column contact_identity_id uuid references contact_identities (id) on delete set null,
  add column last_intent text,
  add column next_action text,
  add column next_action_due timestamptz,
  add column escalation_id uuid references escalations (id) on delete set null;

create index conversations_next_action_idx on conversations (next_action_due)
  where next_action_due is not null and state <> 'closed';

alter table messages
  add column channel text not null default 'sms' check (channel in ('sms','email','portal','call')),
  add column subject text,
  add column confidence numeric(3,2),
  add column tool_calls jsonb not null default '[]'::jsonb;

-- =============================================================================
-- Sending, with consent
-- =============================================================================
-- queue_outbound_message already checked the pause switch, refused to talk over
-- a human, and de-duplicated. It did not check whether the family had agreed to
-- be contacted at all, which is the one that matters legally.

-- Adding a defaulted parameter creates an overload rather than replacing the
-- function, and two versions of this differing only in a trailing default make
-- every two-argument call ambiguous. The old signature goes first.
drop function if exists queue_outbound_message(uuid, text, text, actor_kind, jsonb);

create or replace function queue_outbound_message(
  p_conversation_id uuid,
  p_body            text,
  p_dedupe_key      text default null,
  p_sender_kind     actor_kind default 'ai',
  p_context         jsonb default '{}'::jsonb,
  p_transactional   boolean default false
)
returns messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   messages%rowtype;
  v_conv  conversations%rowtype;
begin
  perform assert_service_only('Sending a message');

  select * into v_conv from conversations where id = p_conversation_id;
  if not found then
    raise exception 'Unknown conversation' using errcode = 'no_data_found';
  end if;

  if automation_paused() and p_sender_kind = 'ai' then
    raise exception 'Automation is paused' using errcode = 'check_violation';
  end if;

  if v_conv.human_owned and p_sender_kind = 'ai' then
    raise exception 'A human owns this conversation' using errcode = 'check_violation';
  end if;

  -- Consent and quiet hours, for anything automated. A person replying by hand
  -- to a family who texted them is answering, not marketing, and is allowed.
  if p_sender_kind = 'ai'
     and v_conv.contact_id is not null
     and not may_contact(v_conv.contact_id, v_conv.channel, p_transactional) then
    raise exception 'That family cannot be contacted on % right now', v_conv.channel
      using errcode = 'check_violation';
  end if;

  insert into messages (conversation_id, direction, sender_kind, body, dedupe_key,
                        channel, booking_id, payment_id, group_id)
  values (
    p_conversation_id, 'outbound', p_sender_kind, p_body, p_dedupe_key,
    v_conv.channel,
    (p_context ->> 'booking_id')::uuid,
    (p_context ->> 'payment_id')::uuid,
    (p_context ->> 'group_id')::uuid
  )
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

-- Inbound, from Quo or from email. Attaches to the right thread, or opens one.
create or replace function record_inbound_message(
  p_channel     text,
  p_from_phone  text,
  p_from_email  text,
  p_body        text,
  p_external_id text,
  p_subject     text default null,
  p_display_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact  uuid;
  v_conv     uuid;
  v_message  messages%rowtype;
  v_household uuid;
  v_stop     boolean;
begin
  perform assert_service_only('Recording an inbound message');

  v_contact := find_or_create_contact(p_from_phone, p_from_email, p_display_name, '');
  select household_id into v_household from contacts where id = v_contact;

  select id into v_conv from conversations
  where contact_id = v_contact and channel = p_channel and state <> 'closed'
  order by last_message_at desc nulls last
  limit 1;

  if v_conv is null then
    insert into conversations (household_id, contact_id, channel, phone_number, agent_state)
    values (v_household, v_contact, p_channel, normalize_phone(p_from_phone), 'new_inquiry')
    returning id into v_conv;
  end if;

  insert into messages (conversation_id, direction, sender_kind, body, external_id,
                        channel, subject)
  values (v_conv, 'inbound', 'parent', p_body, p_external_id, p_channel, p_subject)
  on conflict (external_id) do nothing
  returning * into v_message;

  -- A redelivered webhook is not a new message. Say so, so the agent does not
  -- answer the same text twice.
  if v_message.id is null then
    return jsonb_build_object('duplicate', true, 'conversation_id', v_conv);
  end if;

  update conversations
  set last_message_at = now(), state = 'waiting_on_us'
  where id = v_conv;

  -- STOP is handled here, before anything else looks at the message. It must
  -- work whether or not the agent is running, whether or not it understands
  -- the rest of the text, and whether or not the model is available.
  v_stop := upper(trim(p_body)) in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','OPT OUT');

  if v_stop then
    perform record_consent(v_contact, case when p_channel = 'email' then 'email' else 'all' end,
                           false, p_channel);

    update conversations set agent_state = 'closed', state = 'closed' where id = v_conv;

    return jsonb_build_object('conversation_id', v_conv, 'contact_id', v_contact,
                              'message_id', v_message.id, 'opted_out', true);
  end if;

  if upper(trim(p_body)) in ('START','UNSTOP','YES','SUBSCRIBE') then
    perform record_consent(v_contact, 'all', true, p_channel);
  end if;

  return jsonb_build_object(
    'conversation_id', v_conv,
    'contact_id', v_contact,
    'household_id', v_household,
    'message_id', v_message.id,
    'opted_out', false
  );
end;
$$;

-- =============================================================================
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

-- =============================================================================
-- Escalation, with everything a person needs to pick it up
-- =============================================================================

alter table escalations
  add column household_id uuid references households (id) on delete set null,
  add column contact_id uuid references contacts (id) on delete set null,
  add column player_id uuid references players (id) on delete set null,
  add column conversation_id uuid references conversations (id) on delete set null,
  add column channel text,
  add column recommended_action text,
  add column owner_id uuid,
  add column due_at timestamptz;

create index escalations_queue_idx on escalations (state, severity, due_at)
  where state in ('open','acknowledged');

-- The triggers, as agreed, in one place. The agent calls this rather than
-- deciding for itself what counts as serious.
create or replace function escalate_conversation(
  p_conversation_id uuid,
  p_reason   text,
  p_summary  text,
  p_severity text default 'normal',
  p_recommended_action text default '',
  p_detail   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv conversations%rowtype;
  v_id   uuid;
  v_due  interval;
begin
  perform assert_service_only('Escalating');

  select * into v_conv from conversations where id = p_conversation_id;

  -- How fast a person has to look. Safety and money are not a next-morning
  -- problem.
  v_due := case p_severity
    when 'urgent' then interval '1 hour'
    when 'normal' then interval '4 hours'
    else interval '24 hours'
  end;

  insert into escalations (source, severity, summary, detail, recommended_action,
                           household_id, contact_id, conversation_id, channel,
                           subject_table, subject_id, due_at)
  values (p_reason, p_severity, p_summary, p_detail, p_recommended_action,
          v_conv.household_id, v_conv.contact_id, p_conversation_id, v_conv.channel,
          'conversations', p_conversation_id, now() + v_due)
  returning id into v_id;

  -- The agent stops talking on this thread. A robot and a person answering the
  -- same worried parent is worse than either alone.
  update conversations
  set agent_state = 'escalated', human_owned = true, escalation_id = v_id
  where id = p_conversation_id;

  perform write_audit('ai', null, 'escalation.raised', 'escalations', v_id,
                      null, jsonb_build_object('summary', p_summary, 'severity', p_severity,
                                               'reason', p_reason));

  return v_id;
end;
$$;

-- The phrases that must never be answered by a model. Checked in SQL, before
-- the message reaches the agent, so an escalation does not depend on the model
-- choosing to escalate.
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
-- RLS
-- =============================================================================

alter table contact_identities          enable row level security;
alter table parent_player_relationships enable row level security;
alter table scheduled_followups         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contact_identities','parent_player_relationships','scheduled_followups']
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())',
      t || '_admin_all', t);
  end loop;
end;
$$;

-- A parent sees who is linked to their own children, and nothing else here.
create policy parent_player_relationships_own on parent_player_relationships
  for select to authenticated
  using (exists (select 1 from players p
                 where p.id = player_id and p.household_id = current_household_id()));

-- contact_identities and scheduled_followups carry only the admin policy. They
-- are operational, and a family reading their own follow-up schedule would be
-- reading our sales notes about them.

-- =============================================================================
-- Grants
-- =============================================================================
-- Every function above is service-role only. The agent reaches them through an
-- edge function holding a key that never leaves the server; a browser cannot
-- call any of them, and neither can a prompt.

revoke all on function find_or_create_contact(text, text, text, text) from public, anon, authenticated;
revoke all on function record_inbound_message(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function agent_context(uuid) from public, anon, authenticated;
revoke all on function agent_options_for_player(uuid) from public, anon, authenticated;
revoke all on function schedule_followup(uuid, text, timestamptz, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function escalate_conversation(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function record_consent(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function find_contact(text, text) from public, anon, authenticated;

-- These two are pure and carry no data, so they are safe anywhere.
grant execute on function normalize_phone(text) to anon, authenticated;
grant execute on function must_escalate(text)   to anon, authenticated;
