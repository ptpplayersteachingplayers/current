-- =============================================================================
-- Module: agent — 020 follow-ups and the CRM view
-- =============================================================================
-- What HubSpot needs to know about a family, assembled here rather than in the
-- integration. The sync function then does no thinking of its own — it reads
-- these rows and writes them out — which means the definition of "lifetime
-- spend" or "lead status" is one line of SQL and not a paragraph of TypeScript
-- somebody has to find.
-- =============================================================================

create or replace function hubspot_sync_batch(p_since timestamptz)
returns table (
  contact_id uuid,
  household_id uuid,
  hubspot_contact_id text,
  email text,
  phone text,
  first_name text,
  last_name text,
  players text,
  player_ages text,
  teams text,
  preferred_locations text,
  camp_interest text,
  training_interest text,
  last_session timestamptz,
  last_camp date,
  lifetime_spend_cents bigint,
  credits_available integer,
  booking_status text,
  lead_status text,
  sms_consent boolean,
  email_consent boolean,
  last_contact_at timestamptz,
  next_followup_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.household_id,
    c.hubspot_contact_id,
    c.email::text,
    c.phone,
    c.first_name,
    c.last_name,

    (select string_agg(p.first_name, ', ' order by p.first_name)
     from players p where p.household_id = c.household_id),

    (select string_agg(extract(year from age(p.birth_date))::int::text, ', ' order by p.first_name)
     from players p where p.household_id = c.household_id and p.birth_date is not null),

    (select string_agg(distinct nullif(p.club_team, ''), ', ')
     from players p where p.household_id = c.household_id),

    (select string_agg(distinct l.city, ', ')
     from bookings b
     join sessions s on s.id = b.session_id
     join locations l on l.id = s.location_id
     where b.household_id = c.household_id),

    -- Interest, not history: what they have asked about and not yet bought.
    (select string_agg(distinct coalesce(nullif(i.preferred_location, ''), i.postal_code), ', ')
     from camp_interest i
     where i.household_id = c.household_id and i.converted_at is null),

    (select string_agg(distinct g.name, ', ')
     from enrollments e join training_groups g on g.id = e.group_id
     where e.household_id = c.household_id and e.state = 'active'),

    (select max(s.starts_at) from bookings b join sessions s on s.id = b.session_id
     where b.household_id = c.household_id and b.status in ('confirmed','attended')),

    (select max(cm.starts_on) from camp_registrations r join camps cm on cm.id = r.camp_id
     where r.household_id = c.household_id and r.status in ('confirmed','attended')),

    -- What they have actually paid, net of refunds. A lifetime value that
    -- ignores refunds is a number that makes the business look better than it
    -- is, which is the least useful kind.
    (select coalesce(sum(pay.amount_cents - pay.refunded_cents), 0)
     from payments pay
     where pay.household_id = c.household_id and pay.status in ('succeeded','partially_refunded')),

    (select count(*)::integer from package_credits pc
     where pc.household_id = c.household_id and pc.state = 'available'),

    case
      when exists (select 1 from bookings b join sessions s on s.id = b.session_id
                   where b.household_id = c.household_id and b.status = 'confirmed'
                     and s.starts_at > now())
        then 'active'
      when exists (select 1 from camp_registrations r join camps cm on cm.id = r.camp_id
                   where r.household_id = c.household_id and r.status = 'confirmed'
                     and cm.starts_on >= current_date)
        then 'registered'
      when exists (select 1 from bookings b where b.household_id = c.household_id
                     and b.status in ('confirmed','attended'))
        then 'lapsed'
      else 'none'
    end,

    case
      when c.unsubscribed_at is not null then 'unsubscribed'
      when exists (select 1 from escalations e where e.household_id = c.household_id
                     and e.state in ('open','acknowledged')) then 'needs_attention'
      when exists (select 1 from bookings b where b.household_id = c.household_id
                     and b.status = 'confirmed') then 'customer'
      when exists (select 1 from booking_holds h where h.household_id = c.household_id
                     and h.expires_at > now()) then 'in_checkout'
      when exists (select 1 from camp_interest i where i.household_id = c.household_id
                     and i.converted_at is null) then 'interested'
      else 'lead'
    end,

    c.sms_consent,
    c.email_consent,

    (select max(m.created_at) from messages m
     join conversations cv on cv.id = m.conversation_id
     where cv.household_id = c.household_id),

    (select min(f.due_at) from scheduled_followups f
     where f.household_id = c.household_id and f.state = 'pending')

  from contacts c
  where c.is_primary
    -- Only what has moved. A full push every hour would be most of the day
    -- spent rewriting rows that have not changed.
    and (
      c.updated_at >= p_since
      or exists (select 1 from bookings b where b.household_id = c.household_id and b.updated_at >= p_since)
      or exists (select 1 from camp_registrations r where r.household_id = c.household_id and r.updated_at >= p_since)
      or exists (select 1 from payments pay where pay.household_id = c.household_id and pay.updated_at >= p_since)
      or exists (select 1 from camp_interest i where i.household_id = c.household_id and i.created_at >= p_since)
      or exists (select 1 from conversations cv
                 join messages m on m.conversation_id = cv.id
                 where cv.household_id = c.household_id and m.created_at >= p_since)
    );
$$;

revoke all on function hubspot_sync_batch(timestamptz) from public, anon, authenticated;

comment on function hubspot_sync_batch is
  'The CRM view of a family, defined in SQL so the integration does no thinking. One direction only: HubSpot never writes back what a family has paid for.';

-- =============================================================================
-- Following up
-- =============================================================================
-- The list from the specification, each with the reason it is worth a message
-- and the check that stops it being sent to someone it no longer applies to.

create or replace function queue_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  v_row record;
begin
  perform assert_service_only('Queueing follow-ups');

  if automation_paused() then
    return 0;
  end if;

  -- A payment link sent and not used. Two hours is long enough that they were
  -- interrupted rather than still typing.
  for v_row in
    select ci.household_id, ci.id
    from checkout_intents ci
    where ci.state = 'submitted'
      and ci.created_at < now() - interval '2 hours'
      and ci.created_at > now() - interval '7 days'
  loop
    if schedule_followup(v_row.household_id, 'unpaid_link', now(),
                         'checkout_intents', v_row.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- A hold that lapsed. They were mid-checkout and something went wrong.
  for v_row in
    select ci.household_id, ci.id
    from checkout_intents ci
    where ci.state = 'expired' and ci.updated_at > now() - interval '3 days'
  loop
    if schedule_followup(v_row.household_id, 'expired_hold', now(),
                         'checkout_intents', v_row.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- Credits about to expire. This is the one families are most upset to
  -- discover afterwards.
  for v_row in
    select pc.household_id, min(pc.expires_on) as expires_on, count(*) as credits
    from package_credits pc
    where pc.state = 'available'
      and pc.expires_on between current_date and current_date + 21
    group by pc.household_id
  loop
    if schedule_followup(v_row.household_id, 'credits_expiring', now(),
                         'package_credits', null) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- A group one family short. The most valuable message the business can send.
  for v_row in
    select i.household_id, g.id as group_id
    from training_groups g
    cross join lateral group_occupancy(g.id) o
    join camp_interest i on true
    where g.status = 'forming'
      and o.paid = g.min_players - 1
      and i.converted_at is null
      and i.household_id is not null
    limit 50
  loop
    if schedule_followup(v_row.household_id, 'group_nearly_running', now(),
                         'training_groups', v_row.group_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- Early access that never turned into a registration, once the camps are on
  -- sale.
  for v_row in
    select i.household_id, i.id
    from camp_interest i
    where i.converted_at is null
      and i.household_id is not null
      and i.created_at < now() - interval '3 days'
      and exists (select 1 from camps c
                  where c.season_year = i.season_year
                    and c.status in ('registration_open','limited'))
  loop
    if schedule_followup(v_row.household_id, 'camps_now_open', now(),
                         'camp_interest', v_row.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- A parent waiting on us. Not a marketing message: an apology.
  for v_row in
    select cv.household_id, cv.id
    from conversations cv
    where cv.state = 'waiting_on_us'
      and cv.last_message_at < now() - interval '4 hours'
      and not cv.human_owned
  loop
    if schedule_followup(v_row.household_id, 'awaiting_reply', now(),
                         'conversations', v_row.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

-- The other half: sending what is due, once, to people who have agreed to hear
-- from us, at an hour they will not mind.
create or replace function send_due_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  scheduled_followups%rowtype;
  v_conv uuid;
  v_body text;
  v_sent integer := 0;
begin
  perform assert_service_only('Sending follow-ups');

  if automation_paused() then
    return 0;
  end if;

  for v_row in
    select * from scheduled_followups
    where state = 'pending' and due_at <= now()
    order by due_at
    limit 100
    for update skip locked
  loop
    -- Still true? A family who paid in the meantime should not be chased for
    -- not paying.
    if not followup_still_applies(v_row) then
      update scheduled_followups
      set state = 'skipped', skipped_reason = 'no longer applies'
      where id = v_row.id;
      continue;
    end if;

    if v_row.contact_id is null or not may_contact(v_row.contact_id, v_row.channel) then
      update scheduled_followups
      set state = 'skipped', skipped_reason = 'consent or quiet hours'
      where id = v_row.id;
      continue;
    end if;

    v_conv := conversation_for_household(v_row.household_id);
    v_body := followup_text(v_row.reason);

    begin
      perform queue_outbound_message(v_conv, v_body, 'followup:' || v_row.dedupe_key, 'ai',
                                     jsonb_build_object('followup_id', v_row.id));

      update scheduled_followups set state = 'sent', sent_at = now() where id = v_row.id;
      v_sent := v_sent + 1;
    exception when check_violation then
      update scheduled_followups
      set state = 'skipped', skipped_reason = 'refused at send'
      where id = v_row.id;
    end;
  end loop;

  return v_sent;
end;
$$;

create or replace function followup_still_applies(p_row scheduled_followups)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case p_row.reason
    when 'unpaid_link' then
      exists (select 1 from checkout_intents where id = p_row.subject_id and state = 'submitted')
    when 'expired_hold' then
      not exists (select 1 from bookings where household_id = p_row.household_id
                    and created_at > p_row.created_at)
    when 'credits_expiring' then
      exists (select 1 from package_credits where household_id = p_row.household_id
                and state = 'available' and expires_on <= current_date + 21)
    when 'group_nearly_running' then
      exists (select 1 from training_groups g
              cross join lateral group_occupancy(g.id) o
              where g.id = p_row.subject_id and g.status = 'forming'
                and o.paid < g.min_players)
    when 'camps_now_open' then
      exists (select 1 from camp_interest where id = p_row.subject_id and converted_at is null)
    when 'awaiting_reply' then
      exists (select 1 from conversations where id = p_row.subject_id
                and state = 'waiting_on_us' and not human_owned)
    else true
  end;
end;
$$;

comment on function followup_still_applies is
  'Checked at send time, not at schedule time. A family who paid an hour ago must not be chased for not paying.';

-- The words. Kept here rather than generated, because a follow-up is the same
-- message every time and a model rewriting it each morning is a way to
-- eventually say something wrong.
create or replace function followup_text(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason
    when 'unpaid_link' then
      'Your place is still there if you want it — the payment link is in the message above. Any trouble with it, just reply here.'
    when 'expired_hold' then
      'It looks like something went wrong when you were booking. Nothing was charged. Reply and we will get it sorted.'
    when 'credits_expiring' then
      'You have training sessions left that expire soon. Reply and we will find dates that work.'
    when 'group_nearly_running' then
      'The group you asked about needs one more family to start. If you are still interested, now is the moment.'
    when 'camps_now_open' then
      'The 2027 camps you asked about are open. Places go in the order they are paid for — reply and we will find you a week.'
    when 'awaiting_reply' then
      'Sorry for the delay — we have your message and someone is coming back to you shortly.'
    else 'Just checking in from PTP. Reply here if we can help.'
  end;
$$;

-- Scheduled work is declared to the platform registry, not added to the
-- platform's dispatcher. Installing this module adds two jobs; uninstalling it
-- removes them, and core never learns their names.

do $mod$ begin
  perform register_module_job('agent', 'queue_followups', 'hourly',      'queue_followups',    false, 110::smallint);
  perform register_module_job('agent', 'send_followups',  'five_minute', 'send_due_followups', false, 111::smallint);
end $mod$;

-- The weekly summary reports a follow-up backlog when this module supplies one.
create or replace function pending_followup_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from scheduled_followups where state = 'pending';
$$;

do $mod$ begin
  perform register_module_metric('agent', 'pending_followups', 'pending_followup_count');
end $mod$;

revoke all on function pending_followup_count() from public, anon, authenticated;

revoke all on function queue_followups() from public, anon, authenticated;
revoke all on function send_due_followups() from public, anon, authenticated;
revoke all on function followup_still_applies(scheduled_followups) from public, anon, authenticated;
