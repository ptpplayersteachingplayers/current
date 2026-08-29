-- =============================================================================
-- 0015 — 2027 summer camps
-- =============================================================================
-- Four camps in deliberately different states, so every screen the camp engine
-- feeds has something real to render and every guard has something to refuse:
--
--   Norristown   registration_open   plenty of room
--   Cherry Hill  limited             six places left
--   Doylestown   full                and a waitlist behind it
--   Princeton    draft               no certificate of insurance, cannot open
--
-- The last one exists to prove the publication guard fires. It should be
-- impossible to move it to registration_open until the COI is in.
-- =============================================================================

begin;

-- ZIP centroids for the area PTP actually serves. The full national file loads
-- from the census gazetteer at deploy; this is enough for the finder to work
-- and for the distance maths to be tested against real coordinates.
insert into postal_centroids (postal_code, city, state, latitude, longitude) values
  ('19401', 'Norristown',    'PA', 40.121500, -75.339900),
  ('19403', 'Norristown',    'PA', 40.156800, -75.400200),
  ('19406', 'King of Prussia','PA', 40.089600, -75.379600),
  ('19446', 'Lansdale',      'PA', 40.234100, -75.291300),
  ('19002', 'Ambler',        'PA', 40.176200, -75.213500),
  ('18901', 'Doylestown',    'PA', 40.310600, -75.128300),
  ('19087', 'Wayne',         'PA', 40.049400, -75.410100),
  ('19010', 'Bryn Mawr',     'PA', 40.021700, -75.324300),
  ('08002', 'Cherry Hill',   'NJ', 39.930900, -75.024800),
  ('08034', 'Cherry Hill',   'NJ', 39.902000, -74.996800),
  ('08540', 'Princeton',     'NJ', 40.357700, -74.660100),
  ('08610', 'Trenton',       'NJ', 40.180800, -74.702000)
on conflict (postal_code) do nothing;

-- =============================================================================
-- The camps
-- =============================================================================

insert into camps (
  id, name, slug, season_year, program_type,
  region, state, city, postal_code, field_name, address_line, latitude, longitude,
  starts_on, ends_on, daily_starts_at, daily_ends_at, half_day_ends_at,
  min_age, max_age,
  full_day_price_cents, half_day_price_cents, offers_full_day, offers_half_day,
  capacity, low_availability_at, status,
  field_approved, permit_status, insurance_status,
  description, weather_plan, refund_policy, offers_protection,
  whats_included, what_to_bring, daily_schedule, faqs
) values

  -- A. Room to spare.
  ('99999999-0000-0000-0000-00000000000a',
   'Norristown Summer Camp — Week 1', 'norristown-week-1', 2027, 'summer_camp',
   'Montgomery County', 'PA', 'Norristown', '19401',
   'Northside Turf', '1 Turf Way, Norristown, PA 19401', 40.121500, -75.339900,
   date '2027-06-21', date '2027-06-25', '09:00', '15:00', '12:00',
   6, 14,
   39500, 27500, true, true,
   60, 10, 'registration_open',
   true, 'permitted', 'received',
   'Five days of small-sided games, technical work and finishing, coached by current college and professional players. Groups are set by age and ability on the first morning.',
   'Heavy rain moves us indoors at the Norristown field house. Lightning stops play for thirty minutes from the last strike, as it does everywhere.',
   'Full refund up to fourteen days before the first day. Inside fourteen days the staffing is already committed, so we offer a credit toward another week instead.',
   true,
   '["Coaching at 8:1 or better","A PTP training shirt","Daily small-sided tournament","End-of-week player report"]',
   '["Boots and trainers","Shin pads","A full water bottle","Packed lunch for full days","Sun cream"]',
   '[{"time":"9:00","what":"Arrival and warm-up"},{"time":"9:30","what":"Technical block"},{"time":"10:45","what":"Small-sided games"},{"time":"12:00","what":"Lunch"},{"time":"13:00","what":"Position-specific work"},{"time":"14:00","what":"Tournament"},{"time":"15:00","what":"Pick-up"}]',
   '[{"q":"What if my child does not know anyone?","a":"Groups are set on the first morning by age and level, and the coaches pair up new players deliberately. Most children arrive alone."},{"q":"Can siblings be in the same group?","a":"If they are within the same age band, yes — tell us at registration."}]'),

  -- B. Nearly gone.
  ('99999999-0000-0000-0000-00000000000b',
   'Cherry Hill Summer Camp — Week 2', 'cherry-hill-week-2', 2027, 'summer_camp',
   'Camden County', 'NJ', 'Cherry Hill', '08002',
   'Kingsway Fields', '400 Kingsway, Cherry Hill, NJ 08002', 39.930900, -75.024800,
   date '2027-07-12', date '2027-07-16', '09:00', '15:00', '12:00',
   6, 14,
   39500, 27500, true, true,
   40, 10, 'registration_open',
   true, 'permitted', 'received',
   'Our New Jersey week, at Kingsway. Same format as Norristown: technical mornings, games after lunch, and a report on every player at the end of the week.',
   'Rain plan is the covered turf at Kingsway. Lightning stops play for thirty minutes from the last strike.',
   'Full refund up to fourteen days before the first day; a credit toward another week inside that.',
   true,
   '["Coaching at 8:1 or better","A PTP training shirt","Daily small-sided tournament","End-of-week player report"]',
   '["Boots and trainers","Shin pads","A full water bottle","Packed lunch for full days","Sun cream"]',
   '[{"time":"9:00","what":"Arrival and warm-up"},{"time":"9:30","what":"Technical block"},{"time":"10:45","what":"Small-sided games"},{"time":"12:00","what":"Lunch"},{"time":"13:00","what":"Position-specific work"},{"time":"14:00","what":"Tournament"},{"time":"15:00","what":"Pick-up"}]',
   '[{"q":"Is there before care?","a":"Yes, from 8am, as an add-on at registration."}]'),

  -- C. Full, with people behind it.
  ('99999999-0000-0000-0000-00000000000c',
   'Doylestown Summer Camp — Week 1', 'doylestown-week-1', 2027, 'summer_camp',
   'Bucks County', 'PA', 'Doylestown', '18901',
   'Central Park Fields', '425 Wells Rd, Doylestown, PA 18901', 40.310600, -75.128300,
   date '2027-06-21', date '2027-06-25', '09:00', '15:00', null,
   6, 14,
   39500, null, true, false,
   24, 6, 'registration_open',
   true, 'permitted', 'received',
   'Our smallest week and the one that fills first. Twenty-four players, four coaches, and a great deal of ball contact.',
   'Rain moves us to the Doylestown indoor facility five minutes away. Lightning stops play for thirty minutes.',
   'Full refund up to fourteen days before the first day.',
   false,
   '["Coaching at 6:1","A PTP training shirt","End-of-week player report"]',
   '["Boots and trainers","Shin pads","A full water bottle","Packed lunch","Sun cream"]',
   '[{"time":"9:00","what":"Arrival and warm-up"},{"time":"9:30","what":"Technical block"},{"time":"11:00","what":"Games"},{"time":"12:00","what":"Lunch"},{"time":"13:00","what":"Finishing"},{"time":"14:00","what":"Tournament"},{"time":"15:00","what":"Pick-up"}]',
   '[]'),

  -- D. Cannot open. No certificate of insurance for the field.
  ('99999999-0000-0000-0000-00000000000d',
   'Princeton Summer Camp — Week 3', 'princeton-week-3', 2027, 'summer_camp',
   'Mercer County', 'NJ', 'Princeton', '08540',
   'Hilltop Park', '1 Hilltop Rd, Princeton, NJ 08540', 40.357700, -74.660100,
   date '2027-07-26', date '2027-07-30', '09:00', '15:00', '12:00',
   6, 14,
   39500, 27500, true, true,
   40, 10, 'draft',
   false, 'unknown', 'requested',
   'Planned for 2027. Not yet open — we do not sell a week until the field is confirmed and the paperwork is in.',
   '', '', false, '[]', '[]', '[]', '[]')

on conflict (id) do nothing;

-- Extras.
insert into camp_addons (camp_id, code, name, description, price_cents) values
  ('99999999-0000-0000-0000-00000000000a', 'before_care', 'Before care, from 8am',
   'Supervised arrival and breakfast from 8am.', 5000),
  ('99999999-0000-0000-0000-00000000000a', 'after_care', 'After care, until 5pm',
   'Supervised games and pick-up until 5pm.', 6500),
  ('99999999-0000-0000-0000-00000000000a', 'protection', 'Camp protection',
   'Cancel for any reason up to 24 hours before and get the week back as a credit.', 3500),
  ('99999999-0000-0000-0000-00000000000b', 'before_care', 'Before care, from 8am',
   'Supervised arrival and breakfast from 8am.', 5000),
  ('99999999-0000-0000-0000-00000000000b', 'protection', 'Camp protection',
   'Cancel for any reason up to 24 hours before and get the week back as a credit.', 3500)
on conflict (camp_id, code) do nothing;

-- Who is coaching.
insert into camp_staffing (camp_id, trainer_id, role, is_featured, status) values
  ('99999999-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000001', 'director', true, 'accepted'),
  ('99999999-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000002', 'coach',    true, 'accepted'),
  ('99999999-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-000000000002', 'director', true, 'accepted'),
  ('99999999-0000-0000-0000-00000000000c', '22222222-0000-0000-0000-000000000001', 'director', true, 'accepted'),
  ('99999999-0000-0000-0000-00000000000c', '22222222-0000-0000-0000-000000000003', 'coach',    false, 'accepted')
on conflict (camp_id, trainer_id) do nothing;

update camps set camp_director_id = '22222222-0000-0000-0000-000000000001'
where slug in ('norristown-week-1','doylestown-week-1');
update camps set camp_director_id = '22222222-0000-0000-0000-000000000002'
where slug = 'cherry-hill-week-2';

commit;

-- =============================================================================
-- Days, registrations, and the states they produce
-- =============================================================================

select generate_camp_days(id) from camps where status <> 'draft';

-- Cherry Hill: 34 of 40 taken, which is inside the limited threshold.
-- Doylestown: 24 of 24, which is full.
--
-- Rather than invent 58 families, the paid registrations are attached to the
-- demo households in rotation. What matters to every screen downstream is the
-- count and the status it produces.
do $$
declare
  v_players uuid[] := array[
    '66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000002',
    '66666666-0000-0000-0000-000000000003','66666666-0000-0000-0000-000000000004',
    '66666666-0000-0000-0000-000000000005','66666666-0000-0000-0000-000000000006',
    '66666666-0000-0000-0000-000000000007','66666666-0000-0000-0000-000000000008',
    '66666666-0000-0000-0000-000000000009','66666666-0000-0000-0000-00000000000a',
    '66666666-0000-0000-0000-00000000000b','66666666-0000-0000-0000-00000000000c'
  ];
  v_player uuid;
  v_house  uuid;
  v_pay    uuid;
  i integer;
begin
  -- Six real registrations at Norristown, one per household. Each carries a
  -- payment, because the check constraint on camp_registrations refuses a
  -- confirmed place without one — which is the whole point of it.
  for i in 1..6 loop
    v_player := v_players[i];
    select household_id into v_house from players where id = v_player;

    insert into payments (household_id, amount_cents, status, description, succeeded_at)
    values (v_house, 39500, 'succeeded', 'Norristown Week 1', now())
    returning id into v_pay;

    insert into camp_registrations (camp_id, player_id, household_id, day_option,
                                    status, payment_id, price_cents,
                                    emergency_contact_name, emergency_contact_phone,
                                    waiver_agreed_at, media_release_agreed_at,
                                    conduct_agreed_at, refund_policy_agreed_at,
                                    medical_auth_agreed_at)
    values ('99999999-0000-0000-0000-00000000000a', v_player, v_house, 'full_day',
            'confirmed', v_pay, 39500, 'Emergency contact', '+12155550999',
            now(), now(), now(), now(), now())
    on conflict do nothing;
  end loop;
end;
$$;

-- Fill the other two to the states the header describes. These are placeholder
-- registrations against one household, present only to move the counters.
do $$
declare
  v_house uuid;
  v_player uuid := '66666666-0000-0000-0000-000000000001';
  v_extra uuid;
  v_pay   uuid;
  i integer;
begin
  select household_id into v_house from players where id = v_player;

  for i in 1..34 loop
    insert into players (id, household_id, first_name, last_name, birth_date, skill_level)
    values (gen_random_uuid(), v_house, 'Camper', 'Placeholder ' || i,
            current_date - interval '10 years', 2)
    returning id into v_extra;

    insert into payments (household_id, amount_cents, status, description, succeeded_at)
    values (v_house, 39500, 'succeeded', 'Cherry Hill Week 2', now())
    returning id into v_pay;

    insert into camp_registrations (camp_id, player_id, household_id, day_option,
                                    status, payment_id, price_cents,
                                    emergency_contact_name, emergency_contact_phone,
                                    waiver_agreed_at, media_release_agreed_at,
                                    conduct_agreed_at, refund_policy_agreed_at,
                                    medical_auth_agreed_at)
    values ('99999999-0000-0000-0000-00000000000b', v_extra, v_house, 'full_day',
            'confirmed', v_pay, 39500, 'Emergency contact', '+12155550999',
            now(), now(), now(), now(), now());
  end loop;

  for i in 1..24 loop
    insert into players (id, household_id, first_name, last_name, birth_date, skill_level)
    values (gen_random_uuid(), v_house, 'Camper', 'Doylestown ' || i,
            current_date - interval '10 years', 2)
    returning id into v_extra;

    insert into payments (household_id, amount_cents, status, description, succeeded_at)
    values (v_house, 39500, 'succeeded', 'Doylestown Week 1', now())
    returning id into v_pay;

    insert into camp_registrations (camp_id, player_id, household_id, day_option,
                                    status, payment_id, price_cents,
                                    emergency_contact_name, emergency_contact_phone,
                                    waiver_agreed_at, media_release_agreed_at,
                                    conduct_agreed_at, refund_policy_agreed_at,
                                    medical_auth_agreed_at)
    values ('99999999-0000-0000-0000-00000000000c', v_extra, v_house, 'full_day',
            'confirmed', v_pay, 39500, 'Emergency contact', '+12155550999',
            now(), now(), now(), now(), now());
  end loop;
end;
$$;

-- Somebody waiting for the week that is gone.
insert into waitlists (camp_id, player_id, household_id, position)
values ('99999999-0000-0000-0000-00000000000c', '66666666-0000-0000-0000-00000000000c',
        '55555555-0000-0000-0000-000000000006', 1)
on conflict do nothing;

-- And a family who asked about Princeton before it opened.
insert into camp_interest (parent_name, phone, email, postal_code,
                           player_name, player_age, preferred_location,
                           preferred_weeks, day_preference, season_year, camp_id)
values ('Simi Adeyemi', '+12155550208', 'simi.demo@example.test', '08540',
        'Tayo', 8, 'Princeton',
        '["2027-07-26"]', 'full_day', 2027, '99999999-0000-0000-0000-00000000000d')
on conflict do nothing;
