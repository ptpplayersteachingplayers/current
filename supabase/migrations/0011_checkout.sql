-- =============================================================================
-- 0011 — Checkout: the path money actually takes
-- =============================================================================
-- Phase 1 built the rules. This is the missing half: how a parent's tap on
-- "Book" becomes a Stripe charge and then a confirmed place, without the
-- browser ever being trusted with a price.
--
-- The shape is deliberate:
--
--   1. The client says WHAT it wants (a group, a session, a slot) and never
--      HOW MUCH. begin_checkout() prices it server-side and writes the amount
--      into a checkout_intents row.
--   2. The edge function creates a Stripe PaymentIntent for exactly that
--      amount and records the intent id back.
--   3. Stripe's webhook — not the browser's success page — settles it.
--
-- Step 3 is why the parent closing their laptop mid-redirect does not lose a
-- booking they paid for, and why a browser that replays the success call
-- cannot conjure a second one.
-- =============================================================================

create table checkout_intents (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households (id) on delete cascade,

  kind           text not null check (kind in ('group_package','group_dropin','private','camp')),

  -- What is being bought. Which of these is set depends on kind; the check
  -- below makes the combinations explicit rather than conventional.
  player_id      uuid not null references players (id) on delete cascade,
  group_id       uuid references training_groups (id) on delete cascade,
  session_id     uuid references sessions (id) on delete cascade,
  private_slot_id uuid references private_slots (id) on delete cascade,
  season_id      uuid references seasons (id) on delete set null,
  -- Camps are added in 0013; the column is declared there rather than here so
  -- the table it points at exists.

  -- Anything kind-specific that is not worth a column: the camp day option,
  -- the add-ons chosen, the forms agreed to.
  options        jsonb not null default '{}'::jsonb,

  -- Priced here, by the server, once. The edge function reads this number and
  -- sends it to Stripe; it never receives one.
  amount_cents   integer not null check (amount_cents >= 0),
  session_count  smallint not null default 1 check (session_count > 0),
  currency       text not null default 'usd',

  state          text not null default 'open'
                   check (state in ('open','submitted','settled','canceled','expired')),

  -- The client's own key for the tap. A double-tap, a retried request or a
  -- flaky network returns the same intent rather than a second charge.
  idempotency_key text not null,

  stripe_payment_intent_id text unique,

  expires_at     timestamptz not null,
  settled_at     timestamptz,
  payment_id     uuid references payments (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint checkout_intents_target_matches_kind check (
    (kind = 'group_package' and group_id is not null)
    or (kind = 'group_dropin' and session_id is not null)
    or (kind = 'private'      and private_slot_id is not null)
    or (kind = 'camp')
  )
);

create unique index checkout_intents_idempotency
  on checkout_intents (household_id, idempotency_key);

create index checkout_intents_open_idx on checkout_intents (expires_at)
  where state in ('open','submitted');

create index checkout_intents_household_idx on checkout_intents (household_id, created_at desc);

create trigger checkout_intents_touch before update on checkout_intents
  for each row execute function touch_updated_at();

comment on table checkout_intents is
  'What a parent asked to buy and what the server decided it costs. The client never sends an amount; this row is the only source of one.';

-- A private booking needs somewhere to hang attendance and notes, so a booked
-- slot materialises a session of kind private.
alter table private_slots
  add column session_id uuid references sessions (id) on delete set null;

-- =============================================================================
-- Pricing, server-side
-- =============================================================================

create or replace function price_group_package(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select setting_int('group_package_price_cents', 56000);
$$;

create or replace function price_group_dropin(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select g.dropin_price_cents
       from sessions s join training_groups g on g.id = s.group_id
      where s.id = p_session_id),
    setting_int('group_dropin_price_cents', 4000)
  );
$$;

-- Private slots may carry their own price; otherwise the hourly rate, prorated
-- to the slot's actual length so a 90-minute slot is not billed as an hour.
create or replace function price_private_slot(p_slot_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when ps.price_cents > 0 then ps.price_cents
    else round(
      setting_int('private_hourly_price_cents', 10000)
      * extract(epoch from (ps.ends_at - ps.starts_at)) / 3600.0
    )::integer
  end
  from private_slots ps where ps.id = p_slot_id;
$$;

-- =============================================================================
-- Starting a checkout
-- =============================================================================

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
declare
  v_player  players%rowtype;
  v_intent  checkout_intents%rowtype;
  v_session sessions%rowtype;
  v_slot    private_slots%rowtype;
  v_group   training_groups%rowtype;
  v_minutes integer := setting_int('hold_minutes', 15);
  v_amount  integer;
  v_count   smallint := 1;
  v_season  uuid;
  v_hold_session uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'A checkout needs an idempotency key' using errcode = 'check_violation';
  end if;

  -- Authorisation before existence: a player who is not yours and a player who
  -- does not exist must give the same answer, or the error is an id oracle.
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  -- Same key, same household: hand back what we already made. This is the
  -- whole defence against a double-tap becoming a double charge, and it is a
  -- unique index rather than a lookup-then-insert, so it holds under a race.
  select * into v_intent
  from checkout_intents
  where household_id = v_player.household_id and idempotency_key = p_idempotency_key;

  if found then
    return v_intent;
  end if;

  if p_kind = 'group_package' then
    select * into v_group from training_groups where id = p_target_id;
    if not found then
      raise exception 'Unknown group' using errcode = 'no_data_found';
    end if;
    if v_group.status not in ('forming','confirmed') then
      raise exception 'That group is not taking bookings' using errcode = 'check_violation';
    end if;

    select season_id into v_season from training_groups where id = p_target_id;
    v_amount := price_group_package(p_target_id);
    v_count  := setting_int('group_package_sessions', 16);

    -- Hold a place. The hold is against the group's next session, which is what
    -- group_occupancy() counts, so a family mid-checkout occupies a spot.
    select id into v_hold_session
    from sessions
    where group_id = p_target_id and status = 'scheduled' and starts_at > now()
    order by starts_at
    limit 1;

    if v_hold_session is null then
      raise exception 'That group has no upcoming sessions' using errcode = 'check_violation';
    end if;

    perform create_booking_hold(v_hold_session, p_player_id, false);

    insert into checkout_intents (household_id, kind, player_id, group_id, season_id,
                                  amount_cents, session_count, idempotency_key, expires_at)
    values (v_player.household_id, p_kind, p_player_id, p_target_id, v_season,
            v_amount, v_count, p_idempotency_key, now() + make_interval(mins => v_minutes))
    returning * into v_intent;

  elsif p_kind = 'group_dropin' then
    select * into v_session from sessions where id = p_target_id;
    if not found then
      raise exception 'Unknown session' using errcode = 'no_data_found';
    end if;

    v_amount := price_group_dropin(p_target_id);

    -- create_booking_hold does the eligibility and capacity work; letting it
    -- raise here means a full group fails before Stripe is ever touched.
    perform create_booking_hold(p_target_id, p_player_id, false);

    insert into checkout_intents (household_id, kind, player_id, group_id, session_id, season_id,
                                  amount_cents, idempotency_key, expires_at)
    values (v_player.household_id, p_kind, p_player_id, v_session.group_id, p_target_id,
            v_session.season_id, v_amount, p_idempotency_key,
            now() + make_interval(mins => v_minutes))
    returning * into v_intent;

  elsif p_kind = 'private' then
    select * into v_slot from private_slots where id = p_target_id for update;
    if not found then
      raise exception 'Unknown slot' using errcode = 'no_data_found';
    end if;
    if v_slot.status <> 'available' then
      raise exception 'That slot is no longer available' using errcode = 'check_violation';
    end if;
    if v_slot.starts_at <= now() + make_interval(hours => setting_int('min_notice_hours', 12)) then
      raise exception 'That slot is too soon to book' using errcode = 'check_violation';
    end if;

    v_amount := price_private_slot(p_target_id);

    update private_slots set status = 'held' where id = p_target_id;

    insert into checkout_intents (household_id, kind, player_id, private_slot_id,
                                  amount_cents, idempotency_key, expires_at)
    values (v_player.household_id, p_kind, p_player_id, p_target_id,
            v_amount, p_idempotency_key, now() + make_interval(mins => v_minutes))
    returning * into v_intent;

  else
    raise exception 'Unknown checkout kind %', p_kind using errcode = 'check_violation';
  end if;

  perform write_audit('parent', auth.uid(), 'checkout.began', 'checkout_intents', v_intent.id,
                      null, jsonb_build_object('kind', p_kind, 'amount_cents', v_amount));

  return v_intent;
end;
$$;

comment on function begin_checkout is
  'Prices a purchase server-side and reserves what it needs. Idempotent on (household, key), so a double-tap returns one intent and one charge.';

-- The edge function records Stripe's id against the intent so the webhook can
-- find its way back.
create or replace function attach_payment_intent(p_intent_id uuid, p_stripe_id text)
returns checkout_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent checkout_intents%rowtype;
begin
  update checkout_intents
  set stripe_payment_intent_id = p_stripe_id,
      state = case when state = 'open' then 'submitted' else state end
  where id = p_intent_id
    and (stripe_payment_intent_id is null or stripe_payment_intent_id = p_stripe_id)
  returning * into v_intent;

  if not found then
    raise exception 'That checkout already has a different payment intent'
      using errcode = 'check_violation';
  end if;

  return v_intent;
end;
$$;

-- =============================================================================
-- Settling — what the Stripe webhook calls
-- =============================================================================
-- Every branch is idempotent, because Stripe will deliver the same event twice
-- and eventually will deliver it late.

create or replace function settle_checkout(
  p_stripe_payment_intent_id text,
  p_amount_cents             integer,
  p_charge_id                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent  checkout_intents%rowtype;
  v_payment payments%rowtype;
  v_package packages%rowtype;
  v_session sessions%rowtype;
  v_slot    private_slots%rowtype;
  v_booking bookings%rowtype;
  v_expires date;
  v_booked  integer := 0;
begin
  select * into v_intent
  from checkout_intents
  where stripe_payment_intent_id = p_stripe_payment_intent_id
  for update;

  if not found then
    -- A charge we cannot attribute is not something to guess about. Record it
    -- and let a person look.
    perform escalate('payment', 'Stripe payment with no matching checkout intent', 'urgent',
                     'payments', null,
                     jsonb_build_object('payment_intent', p_stripe_payment_intent_id,
                                        'amount_cents', p_amount_cents));
    return jsonb_build_object('settled', false, 'reason', 'no_matching_intent');
  end if;

  if v_intent.state = 'settled' then
    return jsonb_build_object('settled', true, 'idempotent', true, 'intent_id', v_intent.id);
  end if;

  -- Stripe is the truth about money, but a mismatch means our price and the
  -- charge disagree, which is never routine.
  if p_amount_cents is distinct from v_intent.amount_cents then
    perform escalate('payment', 'Charged amount does not match the quoted price', 'urgent',
                     'checkout_intents', v_intent.id,
                     jsonb_build_object('quoted_cents', v_intent.amount_cents,
                                        'charged_cents', p_amount_cents));
  end if;

  insert into payments (household_id, amount_cents, status, stripe_payment_intent_id,
                        stripe_charge_id, description, succeeded_at, metadata)
  values (v_intent.household_id, p_amount_cents, 'succeeded', p_stripe_payment_intent_id,
          p_charge_id,
          -- Written for the person who will read it on a receipt, not for the
          -- code. 'group_package' is a value, not a description.
          case v_intent.kind
            when 'group_package' then 'Season package'
            when 'group_dropin'  then 'Single session'
            when 'private'       then 'Private session'
            else v_intent.kind
          end,
          now(),
          jsonb_build_object('checkout_intent_id', v_intent.id, 'kind', v_intent.kind))
  on conflict (stripe_payment_intent_id) do nothing
  returning * into v_payment;

  if v_payment.id is null then
    select * into v_payment from payments
    where stripe_payment_intent_id = p_stripe_payment_intent_id;
  end if;

  if v_intent.kind = 'group_package' then
    select credits_expire_on into v_expires from seasons where id = v_intent.season_id;

    insert into packages (household_id, player_id, season_id, payment_id,
                          session_count, price_cents, expires_on)
    values (v_intent.household_id, v_intent.player_id, v_intent.season_id, v_payment.id,
            v_intent.session_count, v_intent.amount_cents,
            coalesce(v_expires, current_date + 120))
    returning * into v_package;

    perform issue_package_credits(v_package.id);

    -- The place in the group, which is what activation counts.
    insert into enrollments (group_id, player_id, household_id, package_id, is_paid)
    values (v_intent.group_id, v_intent.player_id, v_intent.household_id, v_package.id, true)
    on conflict (group_id, player_id) where state = 'active'
    do update set is_paid = true, package_id = excluded.package_id;

    -- Buying the package books the season. Each session spends one credit, so
    -- "where did my sixteenth session go?" has an answer with a date on it.
    v_booked := book_group_season(v_intent.group_id, v_intent.player_id);

    -- If they were waiting for this spot, they are not waiting any more.
    update waitlists set state = 'converted'
    where group_id = v_intent.group_id and player_id = v_intent.player_id
      and state in ('waiting','invited');

  elsif v_intent.kind = 'group_dropin' then
    v_booking := confirm_booking(v_intent.session_id, v_intent.player_id,
                                 v_payment.id, null, v_intent.amount_cents);
    v_booked := 1;

  elsif v_intent.kind = 'private' then
    select * into v_slot from private_slots where id = v_intent.private_slot_id for update;

    -- A private booking needs a session to hang attendance and notes on.
    if v_slot.session_id is null then
      insert into sessions (kind, trainer_id, location_id, starts_at, ends_at)
      values ('private', v_slot.trainer_id, v_slot.location_id, v_slot.starts_at, v_slot.ends_at)
      returning * into v_session;

      update private_slots set session_id = v_session.id, status = 'booked'
      where id = v_slot.id;
    else
      select * into v_session from sessions where id = v_slot.session_id;
      update private_slots set status = 'booked' where id = v_slot.id;
    end if;

    v_booking := confirm_booking(v_session.id, v_intent.player_id,
                                 v_payment.id, null, v_intent.amount_cents);
    v_booked := 1;

    -- Does this make the trip worth making? 0006 decides; the family is told
    -- either way.
    perform evaluate_trainer_block(v_slot.id);

  elsif v_intent.kind = 'camp' then
    -- settle_camp_checkout() lives in 0014, alongside the camp tables. This
    -- function stays the single dispatcher — plpgsql resolves the call when it
    -- runs, by which time 0014 has been applied.
    v_booked := settle_camp_checkout(v_intent.id, v_payment.id);
  end if;

  update checkout_intents
  set state = 'settled', settled_at = now(), payment_id = v_payment.id
  where id = v_intent.id;

  perform write_audit('system', null, 'checkout.settled', 'checkout_intents', v_intent.id,
                      null, jsonb_build_object('kind', v_intent.kind,
                                               'payment_id', v_payment.id,
                                               'sessions_booked', v_booked));

  return jsonb_build_object(
    'settled', true,
    'intent_id', v_intent.id,
    'payment_id', v_payment.id,
    'kind', v_intent.kind,
    'sessions_booked', v_booked
  );
end;
$$;

comment on function settle_checkout is
  'The only thing that turns money into a place. Called from the Stripe webhook, idempotent on the payment intent, and it escalates rather than guesses when a charge does not match.';

-- =============================================================================
-- Booking a season against credits
-- =============================================================================

create or replace function book_group_season(p_group_id uuid, p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player  players%rowtype;
  v_session sessions%rowtype;
  v_credit  package_credits%rowtype;
  v_n       integer := 0;
begin
  select * into v_player from players where id = p_player_id;

  for v_session in
    select * from sessions
    where group_id = p_group_id and status = 'scheduled' and starts_at > now()
    order by starts_at
  loop
    -- Already booked into this one (a retried webhook, or a drop-in they paid
    -- for before buying the package): leave it alone and keep the credit.
    if exists (
      select 1 from bookings
      where session_id = v_session.id and player_id = p_player_id
        and status not in ('canceled','refunded')
    ) then
      continue;
    end if;

    select * into v_credit
    from package_credits
    where household_id = v_player.household_id
      and state = 'available'
      and expires_on >= v_session.starts_at::date
    order by expires_on asc
    limit 1
    for update skip locked;

    exit when not found;   -- out of credits; the rest of the season stays open

    update package_credits set state = 'reserved' where id = v_credit.id;

    perform confirm_booking(v_session.id, p_player_id, null, v_credit.id, 0, true);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function book_group_season is
  'Spends one credit per upcoming session so a family who bought the package is in the diary for the season, not asked to book sixteen times.';

-- A single session paid for with a credit — the makeup path, and how a family
-- with credits left books an extra session.
create or replace function book_with_credit(p_session_id uuid, p_player_id uuid)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player  players%rowtype;
  v_session sessions%rowtype;
  v_credit  package_credits%rowtype;
  v_booking bookings%rowtype;
begin
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then
    raise exception 'Unknown session' using errcode = 'no_data_found';
  end if;

  -- Already in it. Return what exists rather than spending a second credit.
  select * into v_booking from bookings
  where session_id = p_session_id and player_id = p_player_id
    and status not in ('canceled','refunded');
  if found then
    return v_booking;
  end if;

  -- The eligibility and capacity checks live in the hold, so use one.
  perform create_booking_hold(p_session_id, p_player_id, true);

  select pc.* into v_credit
  from package_credits pc
  join booking_holds bh on bh.credit_id = pc.id
  where bh.session_id = p_session_id and bh.player_id = p_player_id;

  if not found then
    raise exception 'No package credits available' using errcode = 'check_violation';
  end if;

  return confirm_booking(p_session_id, p_player_id, null, v_credit.id, 0);
end;
$$;

-- =============================================================================
-- Refunds
-- =============================================================================
-- cancel_booking() decides whether a refund is due; Stripe performs it; this
-- records it. Unique on the Stripe refund id, so a replayed webhook does not
-- write the money back twice.

create or replace function record_refund(
  p_payment_id       uuid,
  p_amount_cents     integer,
  p_stripe_refund_id text,
  p_reason           text default '',
  p_booking_id       uuid default null
)
returns refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund  refunds%rowtype;
  v_payment payments%rowtype;
begin
  insert into refunds (payment_id, amount_cents, reason, stripe_refund_id, created_by)
  values (p_payment_id, p_amount_cents, p_reason, p_stripe_refund_id, auth.uid())
  on conflict (stripe_refund_id) do nothing
  returning * into v_refund;

  if v_refund.id is null then
    select * into v_refund from refunds where stripe_refund_id = p_stripe_refund_id;
    return v_refund;     -- already recorded; the totals below already include it
  end if;

  update payments
  set refunded_cents = refunded_cents + p_amount_cents,
      status = case when refunded_cents + p_amount_cents >= amount_cents
                    then 'refunded' else 'partially_refunded' end
  where id = p_payment_id
  returning * into v_payment;

  if p_booking_id is not null then
    update bookings set status = 'refunded', refund_id = v_refund.id where id = p_booking_id;
  end if;

  perform write_audit('admin', auth.uid(), 'refund.recorded', 'refunds', v_refund.id,
                      null, jsonb_build_object('payment_id', p_payment_id,
                                               'amount_cents', p_amount_cents));

  return v_refund;
end;
$$;

-- =============================================================================
-- Waitlist conversion
-- =============================================================================

create or replace function accept_waitlist_invite(
  p_waitlist_id     uuid,
  p_idempotency_key text
)
returns checkout_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row waitlists%rowtype;
begin
  select * into v_row from waitlists where id = p_waitlist_id for update;
  if not found then
    raise exception 'Unknown waitlist entry' using errcode = 'no_data_found';
  end if;

  perform assert_household_access(v_row.household_id);

  if v_row.state <> 'invited' then
    raise exception 'That waitlist place has not been offered' using errcode = 'check_violation';
  end if;

  if v_row.invite_expires_at is not null and v_row.invite_expires_at <= now() then
    raise exception 'That invitation has expired' using errcode = 'check_violation';
  end if;

  if not group_has_space(v_row.group_id) then
    raise exception 'That group filled before the invitation was taken up'
      using errcode = 'check_violation';
  end if;

  -- The waitlist row stays 'invited' until the money lands. settle_checkout()
  -- converts it — an accepted invitation that is never paid for must not hold
  -- a spot for ever.
  return begin_checkout('group_package', v_row.player_id, v_row.group_id, p_idempotency_key);
end;
$$;

comment on function accept_waitlist_invite is
  'Turns an invitation into a checkout. The waitlist row only converts when the payment settles, so an unfinished checkout releases the spot with the hold.';

create or replace function decline_waitlist_invite(p_waitlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row waitlists%rowtype;
begin
  select * into v_row from waitlists where id = p_waitlist_id for update;
  if not found then return; end if;

  perform assert_household_access(v_row.household_id);

  update waitlists set state = 'declined' where id = p_waitlist_id;
  perform promote_waitlist(v_row.group_id);
end;
$$;

create or replace function join_waitlist(p_group_id uuid, p_player_id uuid)
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

  if not player_is_eligible(p_player_id, p_group_id) then
    raise exception 'That player is not eligible for this group' using errcode = 'check_violation';
  end if;

  select * into v_row from waitlists
  where group_id = p_group_id and player_id = p_player_id and state in ('waiting','invited');
  if found then
    return v_row;                     -- already in the queue; do not reorder them
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from waitlists where group_id = p_group_id;

  insert into waitlists (group_id, player_id, household_id, position)
  values (p_group_id, p_player_id, v_player.household_id, v_pos)
  returning * into v_row;

  return v_row;
end;
$$;

-- =============================================================================
-- Attendance
-- =============================================================================
-- Recorded by the trainer against the session. Note what it does NOT do: it
-- never touches pay. Once a group is confirmed the trainer is paid for the
-- scheduled hours whoever turns up, which is the point of 0006.

create or replace function record_attendance(
  p_session_id uuid,
  p_player_id  uuid,
  p_state      attendance_state,
  p_note       text default ''
)
returns attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     attendance%rowtype;
  v_booking bookings%rowtype;
begin
  perform assert_can_coach_session(p_session_id);

  select * into v_booking from bookings
  where session_id = p_session_id and player_id = p_player_id
    and status not in ('canceled','refunded');

  insert into attendance (session_id, player_id, booking_id, state, recorded_by, note)
  values (p_session_id, p_player_id, v_booking.id, p_state, auth.uid(), p_note)
  on conflict (session_id, player_id) do update
    set state = excluded.state,
        note = excluded.note,
        recorded_at = now(),
        recorded_by = excluded.recorded_by
  returning * into v_row;

  -- A booking that was attended says so, which is what the parent's history
  -- and the makeup rules read.
  if v_booking.id is not null and p_state in ('present','late') then
    update bookings set status = 'attended' where id = v_booking.id and status = 'confirmed';
  end if;

  return v_row;
end;
$$;

comment on function record_attendance is
  'Upsert on (session, player) so a trainer correcting a tap does not create a second row. Deliberately does not affect trainer pay.';

-- =============================================================================
-- Expiring an abandoned checkout
-- =============================================================================

create or replace function expire_checkout_intents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row checkout_intents%rowtype;
  v_n   integer := 0;
begin
  for v_row in
    select * from checkout_intents
    where state in ('open','submitted') and expires_at <= now()
    for update skip locked
  loop
    update checkout_intents set state = 'expired' where id = v_row.id;

    -- Put a held private slot back on the board. Group holds are released by
    -- expire_booking_holds(), which also returns any reserved credit; camp
    -- holds by expire_camp_holds().
    if v_row.private_slot_id is not null then
      update private_slots set status = 'available'
      where id = v_row.private_slot_id and status = 'held';
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table checkout_intents enable row level security;

create policy checkout_intents_admin on checkout_intents
  for all to authenticated using (is_admin()) with check (is_admin());

-- A parent may read their own checkout — the portal shows "payment pending" —
-- but writes go through begin_checkout(), never through the table.
create policy checkout_intents_own_read on checkout_intents
  for select to authenticated
  using (household_id = current_household_id());
