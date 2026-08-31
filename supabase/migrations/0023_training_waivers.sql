-- =============================================================================
-- 0023 — The waiver, on the training side
-- =============================================================================
-- A camp registration cannot complete without an emergency contact, allergies,
-- medical authorisation and four agreements. Group and private training asked
-- for none of it — the same children, on the same fields, with the same
-- coaches, and no record of who to ring if a nine-year-old goes down.
--
-- Two decisions shape how this differs from the camp version.
--
--   1. It belongs to the player, not the booking. A camp is one week and one
--      form. A season is sixteen sessions, and asking a parent to agree to the
--      same waiver sixteen times would teach them to click through it. One
--      waiver per player, valid for a period, re-signed when it lapses.
--
--   2. It is checked where money starts, not where it lands. Refusing at
--      confirmation would mean taking a payment and then refusing the place.
--      begin_checkout() and book_with_credit() are the two doors in, so both
--      ask first and say exactly what is missing.
--
-- The waiver requirement is a setting. Not because it is optional, but because
-- turning it on for an existing book of families needs a day where they are
-- asked rather than blocked, and that decision is the operator's.
-- =============================================================================

create table player_waivers (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,

  -- Who signed it. A waiver is a person's agreement, so the record names them
  -- rather than only the account it was submitted from.
  signed_by_contact_id uuid references contacts (id) on delete set null,
  signed_by_name       text not null,

  -- What a coach needs on the field, in the minutes before anyone can reach a
  -- parent.
  emergency_contact_name  text not null,
  emergency_contact_phone text not null,
  second_contact_name     text not null default '',
  second_contact_phone    text not null default '',
  medical_notes           text not null default '',
  allergies               text not null default '',
  medications             text not null default '',
  doctor_name             text not null default '',
  doctor_phone            text not null default '',
  insurance_detail        text not null default '',

  -- Agreed, with when. A tick box without a timestamp is not a consent record.
  waiver_agreed_at        timestamptz not null,
  medical_auth_agreed_at  timestamptz not null,
  conduct_agreed_at       timestamptz not null,
  media_release_agreed_at timestamptz,          -- genuinely optional

  valid_from    date not null default current_date,
  expires_on    date not null,

  -- Kept for the record when a newer one supersedes it. A waiver is never
  -- deleted: what was agreed, and when, is the point of having one.
  superseded_at timestamptz,

  created_at    timestamptz not null default now(),

  check (expires_on > valid_from)
);

comment on table player_waivers is
  'One per player, re-signed when it lapses. Superseded rather than replaced, because the question a waiver answers is what was agreed on the day.';

create index player_waivers_player_idx on player_waivers (player_id, expires_on desc);

-- At most one live waiver per player. A second signing supersedes the first
-- rather than sitting alongside it and leaving "which one applies" to a query.
create unique index player_waivers_one_live
  on player_waivers (player_id) where superseded_at is null;

-- =============================================================================
-- Asking, and answering
-- =============================================================================

/*
 * What is missing from a submitted waiver, in words a parent can act on.
 *
 * Mirrors camp_registration_missing() deliberately: the same shape of answer
 * so the same interface can render either, and the same rule that a false
 * checkbox is missing rather than answered.
 */
create or replace function training_waiver_missing(p_details jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(label order by label), '{}')
  from (values
    ('an emergency contact name',  p_details ->> 'emergency_contact_name'),
    ('an emergency contact phone', p_details ->> 'emergency_contact_phone'),
    ('who is signing it',          p_details ->> 'signed_by_name'),
    ('the waiver',                 p_details ->> 'waiver_agreed'),
    ('medical authorisation',      p_details ->> 'medical_auth_agreed'),
    ('the code of conduct',        p_details ->> 'conduct_agreed')
  ) as required(label, value)
  where value is null or value = '' or value = 'false';
$$;

comment on function training_waiver_missing is
  'The media release is absent on purpose. A family who does not want their child photographed still gets to train.';

create or replace function player_waiver_status(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row player_waivers%rowtype;
begin
  perform assert_player_access(p_player_id);

  select * into v_row
  from player_waivers
  where player_id = p_player_id and superseded_at is null;

  if not found then
    return jsonb_build_object('signed', false, 'expired', false, 'expires_on', null);
  end if;

  return jsonb_build_object(
    'signed', true,
    'expired', v_row.expires_on < current_date,
    'expires_on', v_row.expires_on,
    'signed_by', v_row.signed_by_name,
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'allergies', v_row.allergies,
    'medical_notes', v_row.medical_notes,
    -- Whether it will still be valid at the end of the season they are about
    -- to book. Saying so now is kinder than an email in week six.
    'days_left', v_row.expires_on - current_date);
end;
$$;

-- The guard itself. Not security definer on purpose: it is called from inside
-- functions that already are, and it reads one row by primary key.
create or replace function player_has_current_waiver(p_player_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from player_waivers
    where player_id = p_player_id
      and superseded_at is null
      and expires_on >= current_date);
$$;

create or replace function record_player_waiver(p_player_id uuid, p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
  v_player  players%rowtype;
  v_months  integer := setting_int('waiver_valid_months', 12);
  v_id      uuid;
  v_contact uuid;
begin
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  v_missing := training_waiver_missing(p_details);
  if array_length(v_missing, 1) > 0 then
    raise exception 'The waiver still needs %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  select id into v_contact
  from contacts
  where household_id = v_player.household_id
  order by (auth_user_id = auth.uid()) desc nulls last, created_at
  limit 1;

  -- One live waiver per player: the previous one becomes history rather than
  -- being overwritten, so "what was agreed in March" stays answerable.
  update player_waivers
  set superseded_at = now()
  where player_id = p_player_id and superseded_at is null;

  insert into player_waivers (
    player_id, household_id, signed_by_contact_id, signed_by_name,
    emergency_contact_name, emergency_contact_phone,
    second_contact_name, second_contact_phone,
    medical_notes, allergies, medications,
    doctor_name, doctor_phone, insurance_detail,
    waiver_agreed_at, medical_auth_agreed_at, conduct_agreed_at, media_release_agreed_at,
    expires_on)
  values (
    p_player_id, v_player.household_id, v_contact,
    p_details ->> 'signed_by_name',
    p_details ->> 'emergency_contact_name',
    p_details ->> 'emergency_contact_phone',
    coalesce(p_details ->> 'second_contact_name', ''),
    coalesce(p_details ->> 'second_contact_phone', ''),
    coalesce(p_details ->> 'medical_notes', ''),
    coalesce(p_details ->> 'allergies', ''),
    coalesce(p_details ->> 'medications', ''),
    coalesce(p_details ->> 'doctor_name', ''),
    coalesce(p_details ->> 'doctor_phone', ''),
    coalesce(p_details ->> 'insurance_detail', ''),
    now(), now(), now(),
    case when coalesce(p_details ->> 'media_release_agreed', 'false') = 'true' then now() end,
    current_date + make_interval(months => v_months))
  returning id into v_id;

  -- The allergies and medical notes a coach sees on the roster come from the
  -- player row, so the waiver writes them there too rather than leaving two
  -- answers to the same question.
  update players
  set medical_notes = coalesce(nullif(p_details ->> 'medical_notes', ''), medical_notes),
      updated_at = now()
  where id = p_player_id;

  perform write_audit('parent'::actor_kind, auth.uid(), 'waiver.signed',
                      'player_waivers', v_id,
                      jsonb_build_object('player_id', p_player_id));

  return v_id;
end;
$$;

/*
 * The guard, used by both doors into training.
 *
 * Raises rather than returning false, because every caller would otherwise
 * write the same three lines and one of them would eventually get it wrong.
 */
create or replace function assert_training_waiver(p_player_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expires date;
begin
  if not setting_bool('require_training_waiver', true) then
    return;
  end if;

  select expires_on into v_expires
  from player_waivers
  where player_id = p_player_id and superseded_at is null;

  if v_expires is null then
    raise exception 'This player needs a signed waiver before booking training'
      using errcode = 'check_violation';
  end if;

  if v_expires < current_date then
    raise exception 'This player''s waiver expired on % and needs signing again', v_expires
      using errcode = 'check_violation';
  end if;
end;
$$;

-- =============================================================================
-- The two doors
-- =============================================================================
-- Rather than reproduce begin_checkout() and book_with_credit() here, both are
-- renamed and wrapped: the original bodies are unchanged, and a later change
-- to either does not have to remember this file exists.

alter function begin_checkout(text, uuid, uuid, text) rename to begin_checkout_unguarded;
alter function book_with_credit(uuid, uuid)           rename to book_with_credit_unguarded;

create or replace function begin_checkout(
  p_kind            text,
  p_player_id       uuid,
  p_target_id       uuid,
  p_idempotency_key text
)
returns checkout_intents
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Authorisation first, so a player who is not yours and a player with no
  -- waiver cannot be told apart. Otherwise this is an id oracle that answers
  -- "does this child exist" to anyone who asks.
  perform assert_player_access(p_player_id);
  perform assert_training_waiver(p_player_id);

  return begin_checkout_unguarded(p_kind, p_player_id, p_target_id, p_idempotency_key);
end;
$$;

create or replace function book_with_credit(p_session_id uuid, p_player_id uuid)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_player_access(p_player_id);
  perform assert_training_waiver(p_player_id);

  return book_with_credit_unguarded(p_session_id, p_player_id);
end;
$$;

-- The renamed originals are service-only now: everything reaches them through
-- the guarded name above, and leaving the old grant in place would leave the
-- guard optional.
revoke all on function begin_checkout_unguarded(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function book_with_credit_unguarded(uuid, uuid)           from public, anon, authenticated;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so replacing a locked
-- down function with a wrapper of the same name quietly re-opens it to anon.
-- Revoke before granting, every time.
revoke all on function begin_checkout(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function book_with_credit(uuid, uuid)           from public, anon, authenticated;

grant execute on function begin_checkout(text, uuid, uuid, text) to authenticated;
grant execute on function book_with_credit(uuid, uuid)           to authenticated;

-- =============================================================================
-- RLS and grants
-- =============================================================================

alter table player_waivers enable row level security;

-- A family reads and only reads their own. Writing goes through
-- record_player_waiver(), which is what supersedes the previous one and
-- stamps the agreement times — a direct insert could do neither.
create policy player_waivers_own on player_waivers
  for select to authenticated
  using (household_id = current_household_id());

create policy player_waivers_admin on player_waivers
  for all to authenticated using (is_admin()) with check (is_admin());

-- A trainer sees what they need on the field for a player they are coaching,
-- and nothing else. The policy is a select on the same table because the
-- alternative — a view — would need its own policy and drift from this one.
create policy player_waivers_coach on player_waivers
  for select to authenticated
  using (exists (
    select 1
    from bookings b
    join sessions s on s.id = b.session_id
    where b.player_id = player_waivers.player_id
      and b.status in ('confirmed', 'attended')
      and s.trainer_id = current_trainer_id()
      and s.starts_at between now() - interval '1 day' and now() + interval '14 days'));

revoke all on function record_player_waiver(uuid, jsonb) from public, anon, authenticated;
revoke all on function player_waiver_status(uuid)         from public, anon, authenticated;
revoke all on function assert_training_waiver(uuid)       from public, anon, authenticated;
revoke all on function player_has_current_waiver(uuid)    from public, anon, authenticated;

grant execute on function record_player_waiver(uuid, jsonb) to authenticated;
grant execute on function player_waiver_status(uuid)        to authenticated;
grant execute on function training_waiver_missing(jsonb)    to anon, authenticated;
