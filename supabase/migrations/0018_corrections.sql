-- =============================================================================
-- 0018 — Corrections
-- =============================================================================
-- Everything an adversarial audit of 0001–0017 could actually reproduce, with
-- the scenario written beside each fix. None of these were caught by the
-- assertions in verify.sh, which is its own finding — every one of them now has
-- a test.
-- =============================================================================

-- =============================================================================
-- Staff is not a parameter
-- =============================================================================
-- cancel_booking(p_by_staff => true) let any parent convert a late, refundless
-- cancellation into a refund: the flag came from the caller. The edge function
-- passed false, but the RPC is reachable directly, so that discipline bought
-- nothing.

create or replace function cancel_booking(
  p_booking_id uuid,
  p_by_staff   boolean default false,
  p_reason     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_session sessions%rowtype;
  v_hours   numeric;
  v_cutoff  integer := setting_int('free_cancel_hours', 24);
  v_refund  boolean;
  v_makeup  boolean := false;
  v_credit  uuid;
  v_remaining integer;
  v_staff   boolean;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Unknown booking' using errcode = 'no_data_found';
  end if;

  if v_booking.status in ('canceled','refunded') then
    raise exception 'That booking is already cancelled' using errcode = 'check_violation';
  end if;

  perform assert_household_access(v_booking.household_id);

  -- Whether this is a staff cancellation is decided here, from who is actually
  -- calling. p_by_staff is now a request, not an assertion: a parent asking
  -- for a goodwill refund gets the ordinary policy.
  v_staff := p_by_staff and (acting_as_service() or is_admin());

  select * into v_session from sessions where id = v_booking.session_id;

  v_hours := extract(epoch from (v_session.starts_at - now())) / 3600.0;
  v_refund := v_staff or v_hours >= v_cutoff;

  -- Cancelled either way. Whether money goes back is v_refund, decided above
  -- and returned to the caller; the booking's own state does not vary.
  update bookings
  set status = 'canceled',
      canceled_at = now(),
      canceled_by = auth.uid(),
      cancel_reason = p_reason
  where id = p_booking_id;

  -- A credit-paid booking gives the credit back when the cancellation is in
  -- time, or converts it to a makeup if the policy is set that way.
  if v_booking.credit_id is not null then
    if v_refund then
      update package_credits
      set state = 'available', booking_id = null, consumed_at = null
      where id = v_booking.credit_id;
    elsif setting_bool('late_cancel_issues_makeup', false) then
      v_makeup := true;
      update package_credits
      set state = 'available', booking_id = null, consumed_at = null,
          origin = 'makeup', origin_note = 'Late cancellation converted to a makeup'
      where id = v_booking.credit_id
      returning id into v_credit;
    end if;
  end if;

  -- Leaving one session is not leaving the group. A family who bought the
  -- sixteen-session package and cancels week three is still enrolled — and
  -- still counts toward activation, which matters to the other five families.
  -- The enrollment ends only when nothing of theirs is left in the group.
  if v_session.group_id is not null then
    select count(*) into v_remaining
    from bookings b
    join sessions s on s.id = b.session_id
    where s.group_id = v_session.group_id
      and b.player_id = v_booking.player_id
      and b.status not in ('canceled','refunded');

    if v_remaining = 0 then
      update enrollments
      set state = 'withdrawn', withdrawn_at = now()
      where group_id = v_session.group_id and player_id = v_booking.player_id and state = 'active';
    end if;

    perform recompute_group_status(v_session.group_id);
    perform promote_waitlist(v_session.group_id);
  end if;

  perform write_audit(
    (case when v_staff then 'admin' else 'parent' end)::actor_kind,
    auth.uid(), 'booking.canceled', 'bookings', p_booking_id,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object('refund_due', v_refund, 'makeup_issued', v_makeup, 'reason', p_reason));

  return jsonb_build_object(
    'refund_due', v_refund,
    'makeup_issued', v_makeup,
    'makeup_credit_id', v_credit,
    'staff_override', v_staff,
    'left_group', v_session.group_id is not null and coalesce(v_remaining, 0) = 0,
    'hours_notice', round(v_hours, 1)
  );
end;
$$;

-- The same flag, the same fix.
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
  v_staff  boolean;
begin
  select * into v_reg from camp_registrations where id = p_registration_id for update;
  if not found then
    raise exception 'Unknown registration' using errcode = 'no_data_found';
  end if;

  if v_reg.status in ('canceled','refunded') then
    raise exception 'That registration is already cancelled' using errcode = 'check_violation';
  end if;

  perform assert_household_access(v_reg.household_id);

  v_staff := p_by_staff and (acting_as_service() or is_admin());

  select * into v_camp from camps where id = v_reg.camp_id;

  v_days := v_camp.starts_on - current_date;
  v_refund := v_staff or v_days >= v_cutoff;

  update camp_registrations
  set status = 'canceled', canceled_at = now(), cancel_reason = p_reason
  where id = p_registration_id;

  perform recompute_camp_status(v_reg.camp_id);
  perform promote_waitlist_for_camp(v_reg.camp_id);

  perform write_audit(
    (case when v_staff then 'admin' else 'parent' end)::actor_kind,
    auth.uid(), 'camp.canceled', 'camp_registrations', p_registration_id,
    jsonb_build_object('status', v_reg.status),
    jsonb_build_object('refund_due', v_refund, 'days_notice', v_days, 'reason', p_reason));

  return jsonb_build_object(
    'refund_due', v_refund,
    'days_notice', v_days,
    'cutoff_days', v_cutoff,
    'staff_override', v_staff,
    'payment_id', v_reg.payment_id,
    'amount_cents', v_reg.price_cents
  );
end;
$$;

-- =============================================================================
-- record_refund never ran
-- =============================================================================
-- An untyped CASE assigned to a payment_status column: the function raised on
-- every call. Because the cancel endpoint wrapped Stripe and this in one try,
-- a real refund left Stripe, this threw, and the operator was told the refund
-- had failed. The money was gone and the record said otherwise.

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
  v_total   integer;
  v_amount  integer;
begin
  perform assert_service_only('Recording a refund');

  insert into refunds (payment_id, amount_cents, reason, stripe_refund_id, created_by)
  values (p_payment_id, p_amount_cents, p_reason, p_stripe_refund_id, auth.uid())
  on conflict (stripe_refund_id) do nothing
  returning * into v_refund;

  if v_refund.id is null then
    select * into v_refund from refunds where stripe_refund_id = p_stripe_refund_id;
    return v_refund;     -- already recorded; the totals below already include it
  end if;

  select refunded_cents + p_amount_cents, amount_cents
  into v_total, v_amount
  from payments where id = p_payment_id;

  update payments
  set refunded_cents = v_total,
      status = (case when v_total >= v_amount then 'refunded' else 'partially_refunded' end)::payment_status
  where id = p_payment_id;

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
-- confirm_booking accepted anyone's credit
-- =============================================================================
-- Three separate holes in one function: it never checked that the credit
-- belonged to the household, never checked the credit was still available, and
-- never re-checked capacity. So one credit could pay for two bookings, another
-- family's credit could pay for yours, and a webhook arriving after the hold
-- lapsed could overfill a session.

create or replace function confirm_booking(
  p_session_id uuid,
  p_player_id  uuid,
  p_payment_id uuid default null,
  p_credit_id  uuid default null,
  p_price_cents integer default 0,
  p_enroll     boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session sessions%rowtype;
  v_player  players%rowtype;
  v_credit  package_credits%rowtype;
  v_booking bookings%rowtype;
begin
  perform assert_service_only('Confirming a booking');

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  -- Lock the session so the capacity check below cannot race another
  -- confirmation landing at the same moment.
  select * into v_session from sessions where id = p_session_id for update;
  if not found then
    raise exception 'Unknown session' using errcode = 'no_data_found';
  end if;

  -- Idempotent: a replayed webhook finds the booking already made.
  select * into v_booking from bookings
  where session_id = p_session_id and player_id = p_player_id
    and status not in ('canceled','refunded');

  if found then
    return v_booking;
  end if;

  if p_credit_id is not null then
    select * into v_credit from package_credits where id = p_credit_id for update;

    if not found then
      raise exception 'Unknown credit' using errcode = 'no_data_found';
    end if;

    -- The credit has to belong to the family being booked. Without this, a
    -- household id in a request was enough to spend a stranger's package.
    if v_credit.household_id is distinct from v_player.household_id then
      raise exception 'That credit belongs to another household'
        using errcode = 'insufficient_privilege';
    end if;

    -- And it has to be unspent. Without this, the same credit paid for as many
    -- sessions as it was passed to.
    if v_credit.state not in ('available','reserved') then
      raise exception 'That credit has already been used' using errcode = 'check_violation';
    end if;
  end if;

  if p_payment_id is null and p_credit_id is null and p_price_cents > 0 then
    raise exception 'A confirmed booking needs a payment or a credit'
      using errcode = 'check_violation';
  end if;

  -- Capacity, again, at the moment of confirmation. A hold that has since
  -- lapsed does not entitle anyone to a place that was resold.
  if not exists (
    select 1 from booking_holds
    where session_id = p_session_id and player_id = p_player_id and expires_at > now()
  ) and not session_has_space(p_session_id) then
    raise exception 'That session filled while the payment was in flight'
      using errcode = 'check_violation';
  end if;

  insert into bookings (session_id, player_id, household_id, status,
                        payment_id, credit_id, price_cents)
  values (p_session_id, p_player_id, v_player.household_id, 'confirmed',
          p_payment_id, p_credit_id, p_price_cents)
  returning * into v_booking;

  if p_credit_id is not null then
    update package_credits
    set state = 'consumed', booking_id = v_booking.id, consumed_at = now(),
        reserved_until = null
    where id = p_credit_id;
  end if;

  delete from booking_holds where session_id = p_session_id and player_id = p_player_id;

  -- Enrolment is a season commitment and is asked for explicitly. A drop-in is
  -- one Thursday, not a promise: four families dropping in on the same evening
  -- must not activate a group and commit a trainer to sixteen sessions.
  if p_enroll and v_session.group_id is not null then
    insert into enrollments (group_id, player_id, household_id, is_paid)
    values (v_session.group_id, p_player_id, v_player.household_id, true)
    on conflict (group_id, player_id) where state = 'active'
    do update set is_paid = true;
  end if;

  if v_session.group_id is not null then
    perform recompute_group_status(v_session.group_id);
  end if;

  perform write_audit('system', null, 'booking.confirmed', 'bookings', v_booking.id,
                      null, jsonb_build_object('session_id', p_session_id,
                                               'player_id', p_player_id,
                                               'price_cents', p_price_cents));

  return v_booking;
end;
$$;

-- =============================================================================
-- A private session had no lock at all
-- =============================================================================
-- create_booking_hold locked the group row, which serialised group bookings
-- correctly. A private session has no group, so it took no lock, and two
-- families could hold the same slot at the same instant.
--
-- And a second call for the same player reserved a second credit while the
-- ON CONFLICT clause kept pointing the hold at the first — so every extra tap
-- of "book with a credit" destroyed one, permanently, with nothing to recover
-- it.

create or replace function create_booking_hold(
  p_session_id uuid,
  p_player_id  uuid,
  p_use_credit boolean default false
)
returns booking_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session sessions%rowtype;
  v_player  players%rowtype;
  v_hold    booking_holds%rowtype;
  v_existing booking_holds%rowtype;
  v_credit  package_credits%rowtype;
  v_minutes integer := setting_int('hold_minutes', 15);
begin
  perform assert_player_access(p_player_id);

  select * into v_player from players where id = p_player_id;
  if not found then
    raise exception 'Unknown player' using errcode = 'no_data_found';
  end if;

  -- The session row is the lock for every kind of session. Locking the group
  -- covered group bookings and left privates unguarded.
  select * into v_session from sessions where id = p_session_id for update;
  if not found then
    raise exception 'Unknown session' using errcode = 'no_data_found';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'That session is not open for booking' using errcode = 'check_violation';
  end if;

  if v_session.starts_at <= now() + make_interval(hours => setting_int('min_notice_hours', 12)) then
    raise exception 'That session is too soon to book' using errcode = 'check_violation';
  end if;

  if v_session.group_id is not null then
    if not player_is_eligible(p_player_id, v_session.group_id) then
      raise exception 'That player is not eligible for this group' using errcode = 'check_violation';
    end if;

    if not group_has_space(v_session.group_id) then
      raise exception 'That group is full' using errcode = 'check_violation';
    end if;
  end if;

  -- And there has to be room on the field that day. This is the check that
  -- stops drop-ins overfilling a session the enrolled families already fill.
  if not session_has_space(p_session_id) then
    raise exception 'That session is full' using errcode = 'check_violation';
  end if;

  -- An existing hold for this player is extended, and its credit is reused.
  -- Reserving a second credit and then not pointing at it is how the previous
  -- version leaked them.
  select * into v_existing from booking_holds
  where session_id = p_session_id and player_id = p_player_id;

  if found and v_existing.credit_id is not null then
    update booking_holds
    set expires_at = now() + make_interval(mins => v_minutes)
    where id = v_existing.id
    returning * into v_hold;

    update package_credits
    set reserved_until = v_hold.expires_at
    where id = v_existing.credit_id;

    return v_hold;
  end if;

  if p_use_credit then
    select * into v_credit
    from package_credits
    where household_id = v_player.household_id
      and state = 'available'
      and expires_on >= v_session.starts_at::date
    order by expires_on
    limit 1
    for update skip locked;

    if not found then
      raise exception 'No package credits available' using errcode = 'check_violation';
    end if;

    update package_credits
    set state = 'reserved', reserved_until = now() + make_interval(mins => v_minutes)
    where id = v_credit.id;
  end if;

  insert into booking_holds (session_id, player_id, household_id, expires_at, credit_id)
  values (p_session_id, p_player_id, v_player.household_id,
          now() + make_interval(mins => v_minutes), v_credit.id)
  on conflict (session_id, player_id) do update
    set expires_at = excluded.expires_at,
        credit_id  = coalesce(booking_holds.credit_id, excluded.credit_id)
  returning * into v_hold;

  if v_session.group_id is not null then
    perform recompute_group_status(v_session.group_id);
  end if;

  return v_hold;
end;
$$;

-- =============================================================================
-- Reserved credits could not expire
-- =============================================================================
-- expire_package_credits only looked at 'available', so a credit stranded in
-- 'reserved' by the bug above was invisible to every job forever.

create or replace function release_stranded_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with freed as (
    update package_credits c
    set state = 'available', reserved_until = null
    where c.state = 'reserved'
      and (c.reserved_until is null or c.reserved_until <= now())
      and not exists (
        select 1 from booking_holds h
        where h.credit_id = c.id and h.expires_at > now()
      )
      and not exists (select 1 from bookings b where b.credit_id = c.id
                        and b.status not in ('canceled','refunded'))
    returning c.id
  )
  select count(*) into v_n from freed;

  return v_n;
end;
$$;

comment on function release_stranded_credits is
  'A reserved credit whose hold has gone is money the family paid for and cannot spend. This is the sweep that gives it back.';

-- =============================================================================
-- A settlement that should not have happened
-- =============================================================================
-- Two branches in settle_checkout were wrong in the same direction: it settled
-- an intent that had already expired and been released, and it fulfilled an
-- underpayment while merely noting the discrepancy. A one-cent payment bought
-- a $560 season.

create or replace function settle_guard(p_intent checkout_intents, p_amount_cents integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_intent.state = 'expired' then
    return 'expired';
  end if;

  -- Stripe is the truth about money, and a charge that does not match the
  -- price we quoted is not something to fulfil and annotate. Underpayment is
  -- refused outright; an overpayment is fulfilled and escalated, because the
  -- family has the place they paid for and we owe them the difference.
  if p_amount_cents < p_intent.amount_cents then
    return 'underpaid';
  end if;

  if p_amount_cents > p_intent.amount_cents then
    return 'overpaid';
  end if;

  return 'ok';
end;
$$;

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
  v_expires date;
  v_booked  integer := 0;
  v_verdict text;
begin
  perform assert_service_only('Settling a payment');

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

  v_verdict := settle_guard(v_intent, p_amount_cents);

  -- An expired intent has already had its hold released, and the place may
  -- have been resold. Fulfilling it would sell the same spot twice, so the
  -- money is held and a person decides: refund, or find them another place.
  if v_verdict = 'expired' then
    perform escalate('payment', 'Payment arrived after the hold had expired', 'urgent',
                     'checkout_intents', v_intent.id,
                     jsonb_build_object('payment_intent', p_stripe_payment_intent_id,
                                        'amount_cents', p_amount_cents,
                                        'expired_at', v_intent.expires_at));
    return jsonb_build_object('settled', false, 'reason', 'intent_expired');
  end if;

  -- Underpayment is refused rather than fulfilled-and-noted. The previous
  -- version raised the discrepancy and then handed over a $560 season for a
  -- penny in the same transaction.
  if v_verdict = 'underpaid' then
    perform escalate('payment', 'Charge is less than the price quoted', 'urgent',
                     'checkout_intents', v_intent.id,
                     jsonb_build_object('quoted_cents', v_intent.amount_cents,
                                        'charged_cents', p_amount_cents));
    return jsonb_build_object('settled', false, 'reason', 'underpaid',
                              'quoted_cents', v_intent.amount_cents,
                              'charged_cents', p_amount_cents);
  end if;

  -- Overpayment is fulfilled and escalated: the family has bought the thing,
  -- and we owe them the difference.
  if v_verdict = 'overpaid' then
    perform escalate('payment', 'Charge is more than the price quoted', 'urgent',
                     'checkout_intents', v_intent.id,
                     jsonb_build_object('quoted_cents', v_intent.amount_cents,
                                        'charged_cents', p_amount_cents));
  end if;

  insert into payments (household_id, amount_cents, status, stripe_payment_intent_id,
                        stripe_charge_id, description, succeeded_at, metadata)
  values (v_intent.household_id, p_amount_cents, 'succeeded', p_stripe_payment_intent_id,
          p_charge_id,
          case v_intent.kind
            when 'group_package' then 'Season package'
            when 'group_dropin'  then 'Single session'
            when 'private'       then 'Private session'
            when 'camp'          then 'Camp registration'
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

    insert into enrollments (group_id, player_id, household_id, package_id, is_paid)
    values (v_intent.group_id, v_intent.player_id, v_intent.household_id, v_package.id, true)
    on conflict (group_id, player_id) where state = 'active'
    do update set is_paid = true, package_id = excluded.package_id;

    v_booked := book_group_season(v_intent.group_id, v_intent.player_id);

    update waitlists set state = 'converted'
    where group_id = v_intent.group_id and player_id = v_intent.player_id
      and state in ('waiting','invited');

  elsif v_intent.kind = 'group_dropin' then
    perform confirm_booking(v_intent.session_id, v_intent.player_id,
                            v_payment.id, null, v_intent.amount_cents);
    v_booked := 1;

  elsif v_intent.kind = 'private' then
    select * into v_slot from private_slots where id = v_intent.private_slot_id for update;

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

    perform confirm_booking(v_session.id, v_intent.player_id,
                            v_payment.id, null, v_intent.amount_cents);
    v_booked := 1;

    perform evaluate_trainer_block(v_slot.id);

  elsif v_intent.kind = 'camp' then
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

-- =============================================================================
-- A weekend block spanned the whole day
-- =============================================================================
-- evaluate_trainer_block counted any two sessions on the same calendar date as
-- a block and then built the shift from the day's first start to its last end.
-- Two one-hour privates at 9am and 8pm became a confirmed twelve-hour shift:
-- $540 of pay against $200 of revenue, and a trainer committed from breakfast
-- to bedtime.
--
-- A block is now a run of sessions that actually adjoin, walked outward from
-- the slot in question.

create or replace function block_run(p_trainer_id uuid, p_slot_id uuid)
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slot  private_slots%rowtype;
  v_gap   integer := setting_int('block_gap_minutes', 0);
  v_travel integer := setting_int('travel_buffer_minutes', 30);
  v_start timestamptz;
  v_end   timestamptz;
  v_moved boolean := true;
  v_next  record;
begin
  select * into v_slot from private_slots where id = p_slot_id;
  if not found then
    return;
  end if;

  v_start := v_slot.starts_at;
  v_end   := v_slot.ends_at;

  -- Grow the run in both directions while something touches it. A session an
  -- hour later at the same field is part of the block; one eleven hours later
  -- is a different trip.
  while v_moved loop
    v_moved := false;

    for v_next in
      select ps.*
      from private_slots ps
      where ps.trainer_id = p_trainer_id
        and ps.status in ('booked','block_pending','confirmed')
        and ps.starts_at::date = v_slot.starts_at::date
        and (ps.starts_at < v_start or ps.ends_at > v_end)
    loop
      if v_next.ends_at <= v_start
         and v_next.ends_at >= v_start - make_interval(mins =>
               case when v_next.location_id is distinct from v_slot.location_id
                    then v_travel else v_gap + 30 end) then
        v_start := v_next.starts_at;
        v_moved := true;
      elsif v_next.starts_at >= v_end
         and v_next.starts_at <= v_end + make_interval(mins =>
               case when v_next.location_id is distinct from v_slot.location_id
                    then v_travel else v_gap + 30 end) then
        v_end := v_next.ends_at;
        v_moved := true;
      end if;
    end loop;
  end loop;

  return query
  select ps.id, ps.starts_at, ps.ends_at
  from private_slots ps
  where ps.trainer_id = p_trainer_id
    and ps.status in ('booked','block_pending','confirmed')
    and ps.starts_at >= v_start
    and ps.ends_at   <= v_end
  order by ps.starts_at;
end;
$$;

comment on function block_run is
  'The sessions that genuinely adjoin the given one. Same calendar date is not the same block: 9am and 8pm are two trips, and paying a trainer from one to the other is not what the block rule promised.';

create or replace function evaluate_trainer_block(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot     private_slots%rowtype;
  v_min      integer;
  v_is_wknd  boolean;
  v_adjacent integer;
  v_shift    trainer_shifts%rowtype;
  v_start    timestamptz;
  v_end      timestamptz;
begin
  perform assert_service_only('Confirming a trainer block');

  select * into v_slot from private_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown private slot' using errcode = 'no_data_found';
  end if;

  v_is_wknd := extract(dow from v_slot.starts_at) in (0, 6);
  v_min := case when v_is_wknd then setting_int('weekend_min_block_sessions', 2) else 1 end;

  -- A group anchor removes the minimum: the trainer is travelling anyway.
  if slot_adjoins_work(v_slot.trainer_id, v_slot.starts_at, v_slot.ends_at, v_slot.location_id) then
    v_min := 1;
  end if;

  -- The run that actually touches this slot, not everything sharing its date.
  select count(*)::integer, min(r.starts_at), max(r.ends_at)
  into v_adjacent, v_start, v_end
  from block_run(v_slot.trainer_id, p_slot_id) r;

  if v_adjacent < v_min then
    update private_slots set status = 'block_pending' where id = p_slot_id;

    return jsonb_build_object(
      'confirmed', false,
      'reason', 'awaiting_second_booking',
      'sessions_in_block', v_adjacent,
      'sessions_required', v_min
    );
  end if;

  select * into v_shift
  from trainer_shifts
  where trainer_id = v_slot.trainer_id
    and status <> 'canceled'
    and tstzrange(starts_at, ends_at) && tstzrange(v_start, v_end)
  limit 1;

  if found then
    update trainer_shifts
    set starts_at = least(starts_at, v_start),
        ends_at   = greatest(ends_at, v_end),
        status    = case when status = 'proposed' then 'confirmed' else status end,
        confirmed_at = coalesce(confirmed_at, now())
    where id = v_shift.id;
  else
    insert into trainer_shifts (trainer_id, location_id, starts_at, ends_at, status, confirmed_at, hourly_pay_cents)
    select v_slot.trainer_id, v_slot.location_id, v_start, v_end, 'confirmed', now(), t.hourly_pay_cents
    from trainers t where t.id = v_slot.trainer_id
    returning * into v_shift;
  end if;

  update private_slots
  set status = 'confirmed', shift_id = v_shift.id
  where id in (select r.slot_id from block_run(v_slot.trainer_id, p_slot_id) r)
    and status in ('booked','block_pending');

  perform write_audit('system', null, 'block.confirmed', 'trainer_shifts', v_shift.id,
                      null, jsonb_build_object('sessions', v_adjacent, 'trainer_id', v_slot.trainer_id));

  return jsonb_build_object('confirmed', true, 'shift_id', v_shift.id, 'sessions_in_block', v_adjacent);
end;
$$;

-- =============================================================================
-- The travel buffer was a maximum, not a minimum
-- =============================================================================
-- slot_adjoins_work read "starts no later than the end plus the buffer", so a
-- private beginning one minute after a group session twenty miles away counted
-- as adjoining, and a forty-five minute gap at the same field did not. The
-- buffer is the time a trainer needs to get there; a gap smaller than it is
-- the problem, not the qualification.

create or replace function slot_adjoins_work(
  p_trainer_id  uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_location_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reach  integer := setting_int('block_reach_minutes', 90);
  v_travel integer := setting_int('travel_buffer_minutes', 30);
begin
  -- Adjacent to a confirmed group session?
  if exists (
    select 1
    from sessions s
    join training_groups g on g.id = s.group_id
    where s.trainer_id = p_trainer_id
      and s.status = 'scheduled'
      and g.status in ('confirmed','full')
      and adjoins(s.starts_at, s.ends_at, p_starts_at, p_ends_at,
                  s.location_id is distinct from p_location_id, v_reach, v_travel)
  ) then
    return true;
  end if;

  -- Inside or beside a shift the trainer has already committed to?
  if exists (
    select 1 from trainer_shifts sh
    where sh.trainer_id = p_trainer_id
      and sh.status in ('acknowledged','confirmed','in_progress')
      and tstzrange(sh.starts_at - make_interval(mins => v_reach),
                    sh.ends_at   + make_interval(mins => v_reach))
          && tstzrange(p_starts_at, p_ends_at)
  ) then
    return true;
  end if;

  -- Adjacent to another private slot that is already spoken for?
  if exists (
    select 1 from private_slots ps
    where ps.trainer_id = p_trainer_id
      and ps.status in ('booked','block_pending','confirmed')
      and adjoins(ps.starts_at, ps.ends_at, p_starts_at, p_ends_at,
                  ps.location_id is distinct from p_location_id, v_reach, v_travel)
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- Two pieces of work adjoin when the gap between them is small enough to be
-- worth waiting through, and — when they are at different fields — large
-- enough to drive between. Both conditions, not one.
create or replace function adjoins(
  a_start timestamptz, a_end timestamptz,
  b_start timestamptz, b_end timestamptz,
  p_different_location boolean,
  p_reach_minutes integer,
  p_travel_minutes integer
)
returns boolean
language sql
immutable
as $$
  with gap as (
    select case
      when b_start >= a_end then extract(epoch from (b_start - a_end)) / 60
      when a_start >= b_end then extract(epoch from (a_start - b_end)) / 60
      else -1                                    -- they overlap
    end as minutes
  )
  select minutes >= 0
     and minutes <= p_reach_minutes
     and (not p_different_location or minutes >= p_travel_minutes)
  from gap;
$$;

comment on function adjoins is
  'The gap has to be short enough to be worth waiting through, and — across town — long enough to drive. The previous version tested only the first, so a session one minute after another twenty miles away counted as the same block.';

-- =============================================================================
-- promote_waitlist invited everyone for one place
-- =============================================================================
-- It checked whether the group had space, but counted only families still
-- 'waiting'. Outstanding invitations were invisible, so three consecutive runs
-- offered one place to three families, two of whom would lose it.

create or replace function promote_waitlist(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   waitlists%rowtype;
  v_hours integer := setting_int('waitlist_invite_hours', 24);
  v_open  integer;
begin
  select greatest(0, o.capacity - o.total) into v_open
  from group_occupancy(p_group_id) o;

  -- Every live invitation is a place already spoken for.
  v_open := v_open - (
    select count(*) from waitlists
    where group_id = p_group_id and state = 'invited'
      and (invite_expires_at is null or invite_expires_at > now())
  );

  if v_open <= 0 then
    return null;
  end if;

  select * into v_row from waitlists
  where group_id = p_group_id and state = 'waiting'
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

  perform write_audit('system', null, 'waitlist.invited', 'waitlists', v_row.id,
                      null, jsonb_build_object('group_id', p_group_id));

  return v_row.id;
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
  v_open  integer;
begin
  select greatest(0, o.capacity - o.total) into v_open from camp_occupancy(p_camp_id) o;

  v_open := v_open - (
    select count(*) from waitlists
    where camp_id = p_camp_id and state = 'invited'
      and (invite_expires_at is null or invite_expires_at > now())
  );

  if v_open <= 0 then
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
  set state = 'invited', invited_at = now(),
      invite_expires_at = now() + make_interval(hours => v_hours)
  where id = v_row.id;

  perform write_audit('system', null, 'camp_waitlist.invited', 'waitlists', v_row.id,
                      null, jsonb_build_object('camp_id', p_camp_id));

  return v_row.id;
end;
$$;

-- =============================================================================
-- A crashed handler wedged a webhook event for ever
-- =============================================================================
-- claim_webhook_event only re-hands out an event whose claimed_at is null. If
-- the process died between claiming and finishing, the row stayed claimed,
-- every Stripe retry answered "duplicate", and the payment silently never
-- became a booking — the exact outcome 0001 calls the worst available.

create or replace function reap_stale_webhook_claims()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer := setting_int('webhook_claim_timeout_minutes', 10);
  v_n integer;
begin
  with stale as (
    update webhook_events
    set claimed_at = null,
        last_error = coalesce(last_error, 'Handler did not finish; claim released for retry')
    where claimed_at is not null
      and processed_at is null
      and failed_at is null
      and claimed_at < now() - make_interval(mins => v_minutes)
    returning id
  )
  select count(*) into v_n from stale;

  if v_n > 0 then
    perform escalate('payment',
      format('%s webhook events were claimed but never finished', v_n),
      'urgent', 'webhook_events', null,
      jsonb_build_object('released', v_n));
  end if;

  return v_n;
end;
$$;

-- =============================================================================
-- Group session generation miscounted, and could duplicate
-- =============================================================================
-- v_created incremented whether or not the insert fired, so a second run
-- reported sixteen sessions created having created none. And the only thing
-- preventing duplicates was an exclusion constraint that excludes rows with a
-- null trainer or location — so a group with neither got two sets.

do $$ begin
  alter table sessions
    add constraint sessions_one_per_group_start unique (group_id, starts_at);
exception when duplicate_table or duplicate_object then null;
end $$;

create or replace function generate_group_sessions(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   training_groups%rowtype;
  v_season  seasons%rowtype;
  v_meeting group_meeting_times%rowtype;
  v_tz      text := setting_text('display_timezone', 'America/New_York');
  v_date    date;
  v_created integer := 0;
  v_rows    integer;
begin
  perform assert_service_only('Generating a season');

  select * into v_group from training_groups where id = p_group_id;
  if not found then
    raise exception 'Unknown group' using errcode = 'no_data_found';
  end if;

  select * into v_season from seasons where id = v_group.season_id;

  for v_meeting in
    select * from group_meeting_times where group_id = p_group_id order by weekday, starts_time
  loop
    v_date := v_season.starts_on;

    -- Forward to the first occurrence of this weekday.
    while extract(dow from v_date) <> v_meeting.weekday loop
      v_date := v_date + 1;
    end loop;

    while v_date <= v_season.ends_on loop
      insert into sessions (kind, group_id, season_id, trainer_id, location_id, starts_at, ends_at)
      values (
        'group', p_group_id, v_group.season_id, v_group.trainer_id, v_group.location_id,
        ((v_date + v_meeting.starts_time) at time zone v_tz),
        ((v_date + v_meeting.starts_time) at time zone v_tz)
          + make_interval(mins => v_meeting.duration_minutes)
      )
      on conflict do nothing;

      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;

      v_date := v_date + 7;
    end loop;
  end loop;

  return v_created;
end;
$$;

-- =============================================================================
-- The activation guard only ran on UPDATE
-- =============================================================================
-- A group could be inserted straight into 'confirmed' on an unverified field
-- with an uncleared trainer — six families at a locked gate, which is exactly
-- what the guard exists to prevent.

-- The guard body has to cope with there being no OLD row.
create or replace function training_groups_guard_activation()
returns trigger
language plpgsql
as $$
begin
  -- On INSERT there is no previous status, so anything other than draft is an
  -- activation. On UPDATE it is an activation only when it leaves draft.
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    if new.location_id is null or not location_is_schedulable(new.location_id) then
      raise exception 'Group % cannot open: its location is not verified and permitted', new.name
        using errcode = 'check_violation';
    end if;

    if new.trainer_id is null or not trainer_is_assignable(new.trainer_id) then
      raise exception 'Group % cannot open: no assignable trainer (active and background-checked)', new.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists training_groups_activation_guard on training_groups;

create trigger training_groups_activation_guard
  before insert or update on training_groups
  for each row execute function training_groups_guard_activation();

create or replace function camps_guard_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('registration_open','limited','full','waitlist')
     and (tg_op = 'INSERT' or old.status in ('draft','early_access')) then

    if not new.field_approved then
      raise exception 'Camp % cannot open: the field is not approved', new.name
        using errcode = 'check_violation';
    end if;

    if new.insurance_status not in ('received','not_required') then
      raise exception 'Camp % cannot open: no certificate of insurance', new.name
        using errcode = 'check_violation';
    end if;

    if new.offers_full_day and coalesce(new.full_day_price_cents, 0) = 0 then
      raise exception 'Camp % cannot open at $0', new.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists camps_guard on camps;

create trigger camps_guard
  before insert or update on camps
  for each row execute function camps_guard_publication();

-- =============================================================================
-- Jobs
-- =============================================================================

create or replace function jobs_for_tier(p_tier text)
returns text[]
language sql
immutable
as $$
  select case p_tier
    when 'five_minute' then array['expire_holds','expire_camp_holds','expire_checkouts',
                                  'reap_webhook_claims']
    when 'hourly'      then array['lapse_invites','promote_waitlists','promote_camp_waitlists',
                                  'send_reminders','complete_sessions','release_credits']
    when 'daily'       then array['expire_credits','record_hours','flag_near_threshold',
                                  'archive_past_camps']
    when 'weekly'      then array[]::text[]
    else array[]::text[]
  end;
$$;

create or replace function run_scheduled_job(p_job_key text, p_tier text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_items  integer := 0;
begin
  perform assert_service_only('Running a scheduled job');

  -- The pause switch stops everything except the jobs that only ever release
  -- things. Holding a family's spot hostage during an incident helps nobody.
  if automation_paused() and p_job_key not in ('expire_holds','expire_camp_holds',
                                               'expire_checkouts','release_credits',
                                               'reap_webhook_claims') then
    return jsonb_build_object('skipped', true, 'reason', 'automation_paused');
  end if;

  insert into scheduled_jobs (job_key, tier) values (p_job_key, p_tier)
  returning id into v_job_id;

  begin
    case p_job_key
      when 'expire_holds'        then v_items := expire_booking_holds();
      when 'expire_camp_holds'   then v_items := expire_camp_holds();
      when 'expire_checkouts'    then v_items := expire_checkout_intents();
      when 'reap_webhook_claims' then v_items := reap_stale_webhook_claims();
      when 'release_credits'     then v_items := release_stranded_credits();
      when 'lapse_invites'       then v_items := lapse_waitlist_invites();
      when 'promote_waitlists'   then v_items := promote_all_waitlists();
      when 'promote_camp_waitlists' then v_items := promote_all_camp_waitlists();
      when 'send_reminders'      then v_items := send_session_reminders();
      when 'expire_credits'      then v_items := expire_package_credits();
      when 'complete_sessions'   then v_items := complete_past_sessions();
      when 'record_hours'        then v_items := record_completed_shift_hours();
      when 'flag_near_threshold' then v_items := flag_groups_near_threshold();
      when 'archive_past_camps'  then v_items := archive_past_camps();
      else
        raise exception 'Unknown job %', p_job_key using errcode = 'check_violation';
    end case;

    update scheduled_jobs
    set finished_at = now(), succeeded = true, items_processed = v_items
    where id = v_job_id;

    return jsonb_build_object('job', p_job_key, 'items', v_items, 'succeeded', true);

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

-- =============================================================================
-- Settings a browser is allowed to read
-- =============================================================================
-- system_settings had one policy: admins only. So the two mechanisms that
-- exist specifically to stop prices and policies being hardcoded — the
-- catalogue's package price, and the portal's cancellation window — both fell
-- back to constants in code. The interface then disagrees with the checkout
-- the moment ops changes a number, which is the failure the table was built to
-- prevent.
--
-- The fix is a read policy for the keys a parent is already shown, and no
-- others.

create table public_settings_allowlist (key text primary key);

insert into public_settings_allowlist (key) values
  ('display_timezone'),
  ('free_cancel_hours'),
  ('camp_refund_days'),
  ('group_package_price_cents'),
  ('group_package_sessions'),
  ('group_dropin_price_cents'),
  ('private_hourly_price_cents'),
  ('group_min_players'),
  ('group_target_players'),
  ('group_max_players'),
  ('season_weeks'),
  ('sessions_per_week'),
  ('hold_minutes'),
  ('booking_horizon_days'),
  ('min_notice_hours'),
  ('waitlist_invite_hours')
on conflict do nothing;

alter table public_settings_allowlist enable row level security;

create policy public_settings_allowlist_read on public_settings_allowlist
  for select to anon, authenticated using (true);

create policy system_settings_public_read on system_settings
  for select to anon, authenticated
  using (key in (select key from public_settings_allowlist));

comment on table public_settings_allowlist is
  'Which settings a browser may read. Everything a parent is shown is here; nothing operational is. Adding a key here is a deliberate act, which is the point of it being a table rather than a list in a policy.';
