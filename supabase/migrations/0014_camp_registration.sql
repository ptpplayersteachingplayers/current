-- =============================================================================
-- 0014 — Registering for a camp
-- =============================================================================
-- The same shape as the training checkout, deliberately: a hold, a price the
-- server decided, a Stripe payment, and a webhook that settles it. Two flows
-- with two different answers to "when is a place actually yours" is how the
-- old platform ended up with registrations nobody had paid for.
--
-- What is different is the paperwork. A camp needs an emergency contact, a
-- pickup list, allergies and five agreements, and it needs them before the
-- Monday morning rather than chased on the day — so the registration cannot
-- be confirmed without them.
-- =============================================================================

alter table checkout_intents
  add column camp_id uuid references camps (id) on delete cascade;

create index checkout_intents_camp_idx on checkout_intents (camp_id)
  where camp_id is not null;

-- =============================================================================
-- Eligibility and holds
-- =============================================================================

-- Age on the first day of camp, so a child who turns 15 in August is still
-- eligible for a camp in July. Same rule as the group engine, same reason.
create or replace function camp_age_ok(p_camp_id uuid, p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.birth_date is null
         or extract(year from age(c.starts_on, p.birth_date))::int
            between c.min_age and c.max_age
     from camps c, players p
     where c.id = p_camp_id and p.id = p_player_id),
    false
  );
$$;

create or replace function create_camp_hold(
  p_camp_id    uuid,
  p_player_id  uuid,
  p_day_option camp_day_option default 'full_day'
)
returns camp_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp   camps%rowtype;
  v_player players%rowtype;
  v_hold   camp_holds%rowtype;
  v_minutes integer := setting_int('hold_minutes', 15);
begin
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  -- Lock the camp so two families cannot both take the last place.
  select * into v_camp from camps where id = p_camp_id for update;
  if not found then
    raise exception 'Unknown camp' using errcode = 'no_data_found';
  end if;

  -- Fullness is checked before the general status, so a family looking at a
  -- camp they can see is told it is full rather than that it is "not open" —
  -- which sounds like a mistake and prompts a phone call.
  if v_camp.status in ('full','waitlist') or not camp_has_space(p_camp_id) then
    raise exception 'That camp is full' using errcode = 'check_violation';
  end if;

  if v_camp.status not in ('registration_open','limited') then
    raise exception 'That camp is not open for registration' using errcode = 'check_violation';
  end if;

  if not camp_age_ok(p_camp_id, p_player_id) then
    raise exception 'That player is outside the age range for this camp'
      using errcode = 'check_violation';
  end if;

  if p_day_option = 'half_day' and not v_camp.offers_half_day then
    raise exception 'This camp does not offer half days' using errcode = 'check_violation';
  end if;
  if p_day_option = 'full_day' and not v_camp.offers_full_day then
    raise exception 'This camp does not offer full days' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from camp_registrations
    where camp_id = p_camp_id and player_id = p_player_id
      and status not in ('canceled','refunded')
  ) then
    raise exception 'That player is already registered for this camp'
      using errcode = 'check_violation';
  end if;

  insert into camp_holds (camp_id, player_id, household_id, day_option, expires_at)
  values (p_camp_id, p_player_id, v_player.household_id, p_day_option,
          now() + make_interval(mins => v_minutes))
  on conflict (camp_id, player_id) do update
    set expires_at = excluded.expires_at, day_option = excluded.day_option
  returning * into v_hold;

  perform recompute_camp_status(p_camp_id);

  return v_hold;
end;
$$;

create or replace function expire_camp_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row camp_holds%rowtype;
  v_n   integer := 0;
begin
  for v_row in
    select * from camp_holds where expires_at <= now() for update skip locked
  loop
    delete from camp_holds where id = v_row.id;
    perform recompute_camp_status(v_row.camp_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- Pricing
-- =============================================================================

create or replace function price_camp(
  p_camp_id uuid,
  p_day_option camp_day_option,
  p_addon_ids uuid[] default '{}'
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (select case when p_day_option = 'half_day' then c.half_day_price_cents
                   else c.full_day_price_cents end
       from camps c where c.id = p_camp_id),
      0)
    + coalesce(
      (select sum(a.price_cents)::integer from camp_addons a
       where a.id = any(p_addon_ids) and a.camp_id = p_camp_id and a.active),
      0);
$$;

comment on function price_camp is
  'The only place a camp price is computed. Add-ons are priced from their own rows, so a browser cannot invent a cheaper before-care.';

-- =============================================================================
-- Starting a registration
-- =============================================================================
-- Separate from begin_checkout() because a camp takes different inputs — the
-- day option, the add-ons, and the paperwork. It writes the same
-- checkout_intents row, so the Stripe half of the flow is shared.

create or replace function begin_camp_registration(
  p_camp_id     uuid,
  p_player_id   uuid,
  p_day_option  camp_day_option,
  p_idempotency_key text,
  p_addon_ids   uuid[] default '{}',
  p_details     jsonb default '{}'::jsonb
)
returns checkout_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player players%rowtype;
  v_intent checkout_intents%rowtype;
  v_amount integer;
  v_minutes integer := setting_int('hold_minutes', 15);
  v_missing text[];
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'A registration needs an idempotency key' using errcode = 'check_violation';
  end if;

  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  select * into v_intent
  from checkout_intents
  where household_id = v_player.household_id and idempotency_key = p_idempotency_key;

  if found then
    return v_intent;
  end if;

  -- The paperwork is checked here, before Stripe, so a family is never charged
  -- for a place that then cannot be confirmed.
  v_missing := camp_registration_missing(p_details);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Still needed: %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  perform create_camp_hold(p_camp_id, p_player_id, p_day_option);

  v_amount := price_camp(p_camp_id, p_day_option, p_addon_ids);

  insert into checkout_intents (household_id, kind, player_id, camp_id,
                                amount_cents, idempotency_key, expires_at, options)
  values (
    v_player.household_id, 'camp', p_player_id, p_camp_id,
    v_amount, p_idempotency_key, now() + make_interval(mins => v_minutes),
    jsonb_build_object('day_option', p_day_option, 'addon_ids', to_jsonb(p_addon_ids))
      || coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_intent;

  perform write_audit('parent', auth.uid(), 'camp.registration_began', 'checkout_intents',
                      v_intent.id, null,
                      jsonb_build_object('camp_id', p_camp_id, 'amount_cents', v_amount));

  return v_intent;
end;
$$;

-- What is still outstanding on a registration. Returned as a list rather than
-- a boolean so the interface and the AI agent can both say exactly what they
-- still need instead of "invalid".
create or replace function camp_registration_missing(p_details jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(label order by label), '{}')
  from (values
    ('an emergency contact name',  p_details ->> 'emergency_contact_name'),
    ('an emergency contact phone', p_details ->> 'emergency_contact_phone'),
    ('the waiver',                 p_details ->> 'waiver_agreed'),
    ('the media release',          p_details ->> 'media_release_agreed'),
    ('the code of conduct',        p_details ->> 'conduct_agreed'),
    ('the refund policy',          p_details ->> 'refund_policy_agreed'),
    ('medical authorisation',      p_details ->> 'medical_auth_agreed')
  ) as required(label, value)
  where value is null or value = '' or value = 'false';
$$;

-- =============================================================================
-- Settling — called by settle_checkout() when the intent is a camp
-- =============================================================================

create or replace function settle_camp_checkout(p_intent_id uuid, p_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent checkout_intents%rowtype;
  v_reg    camp_registrations%rowtype;
  v_now    timestamptz := now();
  v_addon  uuid;
begin
  select * into v_intent from checkout_intents where id = p_intent_id;

  -- Idempotent: a replayed webhook finds the registration already made.
  select * into v_reg from camp_registrations
  where camp_id = v_intent.camp_id and player_id = v_intent.player_id
    and status not in ('canceled','refunded');

  if found then
    return 1;
  end if;

  insert into camp_registrations (
    camp_id, player_id, household_id, day_option, status, payment_id, price_cents,
    emergency_contact_name, emergency_contact_phone, authorized_pickup,
    medical_notes, allergies, shirt_size,
    waiver_agreed_at, media_release_agreed_at, conduct_agreed_at,
    refund_policy_agreed_at, medical_auth_agreed_at
  )
  values (
    v_intent.camp_id, v_intent.player_id, v_intent.household_id,
    coalesce((v_intent.options ->> 'day_option')::camp_day_option, 'full_day'),
    'confirmed', p_payment_id, v_intent.amount_cents,
    coalesce(v_intent.options ->> 'emergency_contact_name', ''),
    coalesce(v_intent.options ->> 'emergency_contact_phone', ''),
    coalesce(v_intent.options ->> 'authorized_pickup', ''),
    coalesce(v_intent.options ->> 'medical_notes', ''),
    coalesce(v_intent.options ->> 'allergies', ''),
    coalesce(v_intent.options ->> 'shirt_size', ''),
    v_now, v_now, v_now, v_now, v_now
  )
  returning * into v_reg;

  for v_addon in
    select (jsonb_array_elements_text(coalesce(v_intent.options -> 'addon_ids', '[]'::jsonb)))::uuid
  loop
    insert into camp_registration_addons (registration_id, addon_id, price_cents)
    select v_reg.id, a.id, a.price_cents from camp_addons a where a.id = v_addon
    on conflict do nothing;
  end loop;

  delete from camp_holds
  where camp_id = v_intent.camp_id and player_id = v_intent.player_id;

  -- If they were waiting for this camp, they are not waiting any more.
  update waitlists set state = 'converted'
  where camp_id = v_intent.camp_id and player_id = v_intent.player_id
    and state in ('waiting','invited');

  -- And if they came in through early access, stop chasing them.
  update camp_interest set converted_at = now()
  where camp_id = v_intent.camp_id
    and household_id = v_intent.household_id
    and converted_at is null;

  perform recompute_camp_status(v_intent.camp_id);

  perform write_audit('system', null, 'camp.registered', 'camp_registrations', v_reg.id,
                      null, jsonb_build_object('camp_id', v_intent.camp_id,
                                               'payment_id', p_payment_id));

  return 1;
end;
$$;

-- =============================================================================
-- Cancelling
-- =============================================================================

create or replace function cancel_camp_registration(
  p_registration_id uuid,
  p_by_staff boolean default false,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg    camp_registrations%rowtype;
  v_camp   camps%rowtype;
  v_days   numeric;
  v_cutoff integer := setting_int('camp_refund_days', 14);
  v_refund boolean;
begin
  select * into v_reg from camp_registrations where id = p_registration_id for update;
  if not found then
    raise exception 'Unknown registration' using errcode = 'no_data_found';
  end if;

  if v_reg.status in ('canceled','refunded') then
    raise exception 'That registration is already cancelled' using errcode = 'check_violation';
  end if;

  perform assert_household_access(v_reg.household_id);

  select * into v_camp from camps where id = v_reg.camp_id;

  v_days := v_camp.starts_on - current_date;
  v_refund := p_by_staff or v_days >= v_cutoff;

  update camp_registrations
  set status = 'canceled', canceled_at = now(), cancel_reason = p_reason
  where id = p_registration_id;

  perform recompute_camp_status(v_reg.camp_id);
  perform promote_waitlist_for_camp(v_reg.camp_id);

  perform write_audit(
    (case when p_by_staff then 'admin' else 'parent' end)::actor_kind,
    auth.uid(), 'camp.canceled', 'camp_registrations', p_registration_id,
    jsonb_build_object('status', v_reg.status),
    jsonb_build_object('refund_due', v_refund, 'days_notice', v_days, 'reason', p_reason));

  return jsonb_build_object(
    'refund_due', v_refund,
    'days_notice', v_days,
    'cutoff_days', v_cutoff,
    'payment_id', v_reg.payment_id,
    'amount_cents', v_reg.price_cents
  );
end;
$$;

-- =============================================================================
-- Camp waitlists
-- =============================================================================

create or replace function join_camp_waitlist(p_camp_id uuid, p_player_id uuid)
returns waitlists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player players%rowtype;
  v_row    waitlists%rowtype;
  v_pos    integer;
begin
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  if not camp_age_ok(p_camp_id, p_player_id) then
    raise exception 'That player is outside the age range for this camp'
      using errcode = 'check_violation';
  end if;

  select * into v_row from waitlists
  where camp_id = p_camp_id and player_id = p_player_id and state in ('waiting','invited');
  if found then
    return v_row;
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from waitlists where camp_id = p_camp_id;

  insert into waitlists (camp_id, player_id, household_id, position)
  values (p_camp_id, p_player_id, v_player.household_id, v_pos)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function promote_waitlist_for_camp(p_camp_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   waitlists%rowtype;
  v_hours integer := setting_int('waitlist_invite_hours', 24);
begin
  if not camp_has_space(p_camp_id) then
    return null;
  end if;

  select * into v_row from waitlists
  where camp_id = p_camp_id and state = 'waiting'
  order by position
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update waitlists
  set state = 'invited',
      invited_at = now(),
      invite_expires_at = now() + make_interval(hours => v_hours)
  where id = v_row.id;

  perform write_audit('system', null, 'camp_waitlist.invited', 'waitlists', v_row.id,
                      null, jsonb_build_object('camp_id', p_camp_id));

  return v_row.id;
end;
$$;

-- =============================================================================
-- Attendance
-- =============================================================================

create table camp_attendance (
  id           uuid primary key default gen_random_uuid(),
  camp_session_id uuid not null references camp_sessions (id) on delete cascade,
  player_id    uuid not null references players (id) on delete cascade,
  registration_id uuid references camp_registrations (id) on delete set null,
  state        attendance_state not null,
  recorded_at  timestamptz not null default now(),
  recorded_by  uuid,
  note         text not null default '',

  unique (camp_session_id, player_id)
);

create index camp_attendance_session_idx on camp_attendance (camp_session_id);

create or replace function record_camp_attendance(
  p_camp_session_id uuid,
  p_player_id uuid,
  p_state attendance_state,
  p_note text default ''
)
returns camp_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row camp_attendance%rowtype;
  v_reg camp_registrations%rowtype;
  v_camp uuid;
begin
  select camp_id into v_camp from camp_sessions where id = p_camp_session_id;
  if v_camp is null then
    raise exception 'Unknown camp day' using errcode = 'no_data_found';
  end if;

  -- Anyone staffing the camp may take the register; nobody else may.
  if auth.uid() is not null and not is_admin() and not exists (
    select 1 from camp_staffing s
    where s.camp_id = v_camp and s.trainer_id = current_trainer_id()
      and s.status = 'accepted'
  ) then
    raise exception 'You are not staffing that camp' using errcode = 'insufficient_privilege';
  end if;

  select * into v_reg from camp_registrations
  where camp_id = v_camp and player_id = p_player_id
    and status not in ('canceled','refunded');

  insert into camp_attendance (camp_session_id, player_id, registration_id, state, recorded_by, note)
  values (p_camp_session_id, p_player_id, v_reg.id, p_state, auth.uid(), p_note)
  on conflict (camp_session_id, player_id) do update
    set state = excluded.state, note = excluded.note,
        recorded_at = now(), recorded_by = excluded.recorded_by
  returning * into v_row;

  return v_row;
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table camps                    enable row level security;
alter table camp_sessions            enable row level security;
alter table camp_staffing            enable row level security;
alter table camp_addons              enable row level security;
alter table camp_registrations       enable row level security;
alter table camp_registration_addons enable row level security;
alter table camp_holds               enable row level security;
alter table camp_interest            enable row level security;
alter table camp_attendance          enable row level security;
alter table postal_centroids         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'camps','camp_sessions','camp_staffing','camp_addons','camp_registrations',
    'camp_registration_addons','camp_holds','camp_interest','camp_attendance',
    'postal_centroids'
  ]
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())',
      t || '_admin_all', t
    );
  end loop;
end;
$$;

-- The public catalogue. A draft camp is invisible; an archived one is out of
-- the listings. Anonymous visitors see exactly what is on sale.
create policy camps_public on camps
  for select to authenticated, anon
  using (status in ('early_access','registration_open','limited','full','waitlist'));

create policy camp_sessions_public on camp_sessions
  for select to authenticated, anon using (true);

create policy camp_addons_public on camp_addons
  for select to authenticated, anon using (active);

create policy camp_staffing_public on camp_staffing
  for select to authenticated, anon using (status = 'accepted');

create policy postal_centroids_public on postal_centroids
  for select to authenticated, anon using (true);

-- Families see their own registrations and nothing else. Rows are written by
-- edge functions with the service role, never from a browser.
create policy camp_registrations_own on camp_registrations
  for select to authenticated
  using (household_id = current_household_id());

create policy camp_registration_addons_own on camp_registration_addons
  for select to authenticated
  using (exists (
    select 1 from camp_registrations r
    where r.id = registration_id and r.household_id = current_household_id()
  ));

create policy camp_holds_own on camp_holds
  for select to authenticated
  using (household_id = current_household_id());

create policy camp_attendance_own on camp_attendance
  for select to authenticated
  using (exists (
    select 1 from players p where p.id = player_id and p.household_id = current_household_id()
  ));

-- A trainer sees the roster and the register for a camp they are staffing.
create policy camp_registrations_staff on camp_registrations
  for select to authenticated
  using (exists (
    select 1 from camp_staffing s
    where s.camp_id = camp_registrations.camp_id
      and s.trainer_id = current_trainer_id()
      and s.status = 'accepted'
  ));

create policy camp_attendance_staff on camp_attendance
  for all to authenticated
  using (exists (
    select 1 from camp_sessions cs
    join camp_staffing s on s.camp_id = cs.camp_id
    where cs.id = camp_session_id
      and s.trainer_id = current_trainer_id()
      and s.status = 'accepted'
  ))
  with check (exists (
    select 1 from camp_sessions cs
    join camp_staffing s on s.camp_id = cs.camp_id
    where cs.id = camp_session_id
      and s.trainer_id = current_trainer_id()
      and s.status = 'accepted'
  ));

-- Early access is write-only from the outside: anyone may register interest,
-- nobody may read the list back.
create policy camp_interest_insert on camp_interest
  for insert to authenticated, anon with check (true);
