-- =============================================================================
-- 0010 — Demo season
-- =============================================================================
-- One eight-week season, six groups meeting twice a week, four trainers, three
-- verified fields, and seven families in deliberately different states so every
-- screen has something real to render:
--
--   Group A  Full        6 paid — Ada is waiting, and is eligible
--   Group B  Forming     2 paid
--   Group C  Confirmed   4 paid — exactly on the activation line
--   Group D  Forming     3 paid — one booking away from confirming
--   Group E  Forming     0 paid — nobody yet
--   Group F  Draft       no field verified, so it cannot open at all
--
-- Group F exists to prove the activation guard fires. It should be impossible
-- to move it out of draft until its location is verified.
--
-- The Adeyemi family have browsed and not paid. Tayo is eligible for Group D
-- and enrolled nowhere, which makes them the fourth family the checkout tests
-- run through — and the one the AI agent should be chasing hardest.
--
-- Safe to re-run: everything is keyed and uses ON CONFLICT DO NOTHING.
-- =============================================================================

begin;

-- =============================================================================
-- Locations
-- =============================================================================

insert into locations (id, name, address_line, city, state, postal_code, surface,
                       has_lighting, permit_status, contact_name, contact_phone,
                       parking_notes, meeting_instructions, verified_at)
values
  ('11111111-0000-0000-0000-000000000001', 'Riverside Park — Field 3',
   '400 Riverside Dr', 'Norristown', 'PA', '19401', 'grass', true, 'permitted',
   'Parks Dept — Dana Kohl', '+16105550142',
   'Lot off Riverside Dr; overflow on Elm.',
   'Meet at the scoreboard end, not the playground gate.',
   now() - interval '9 days'),

  ('11111111-0000-0000-0000-000000000002', 'Northside Turf',
   '88 Ridge Pike', 'Conshohocken', 'PA', '19428', 'turf', true, 'reserved',
   'Facility — Marc Ellery', '+16105550188',
   'Gated lot, code 4417.',
   'Turf 2, far side. Boots only, no metal studs.',
   now() - interval '3 days'),

  ('11111111-0000-0000-0000-000000000003', 'Eastfield Rec',
   '12 Eastfield Rd', 'Plymouth Meeting', 'PA', '19462', 'grass', false, 'informal',
   'Rec Board — Tanya Ruiz', '+16105550119',
   'Street parking on Eastfield Rd.',
   'Bottom pitch by the treeline. No lights — winter sessions end by 4:30.',
   now() - interval '20 days'),

  -- Deliberately unverified. Group F is attached to it and must not open.
  ('11111111-0000-0000-0000-000000000004', 'Westgate Fields (pending)',
   '9 Westgate Ave', 'King of Prussia', 'PA', '19406', 'grass', false, 'unknown',
   'Unknown', '', '', 'Availability not yet confirmed with the township.', null)
on conflict (id) do nothing;

update locations set backup_location_id = '11111111-0000-0000-0000-000000000002'
where id = '11111111-0000-0000-0000-000000000001';

insert into field_availability_windows (location_id, weekday, starts_time, ends_time, note) values
  ('11111111-0000-0000-0000-000000000001', 2, '16:00', '20:00', 'Tue after-school'),
  ('11111111-0000-0000-0000-000000000001', 4, '16:00', '20:00', 'Thu after-school'),
  ('11111111-0000-0000-0000-000000000001', 6, '09:00', '13:00', 'Sat mornings'),
  ('11111111-0000-0000-0000-000000000002', 1, '16:00', '21:00', 'Mon'),
  ('11111111-0000-0000-0000-000000000002', 3, '16:00', '21:00', 'Wed'),
  ('11111111-0000-0000-0000-000000000002', 6, '08:00', '14:00', 'Sat'),
  ('11111111-0000-0000-0000-000000000003', 1, '15:30', '18:30', 'Mon, daylight only'),
  ('11111111-0000-0000-0000-000000000003', 3, '15:30', '18:30', 'Wed, daylight only')
on conflict do nothing;

-- =============================================================================
-- Trainers
-- =============================================================================

insert into trainers (id, display_name, slug, bio, phone, email, hourly_pay_cents,
                      status, background_check_status, background_check_expires_at,
                      auth_user_id)
values
  ('22222222-0000-0000-0000-000000000001', 'Marcus Bell', 'marcus-bell',
   'Four years NCAA Division I midfield. Coaches the small-sided possession work the older groups run on.',
   '+12155550101', 'marcus@example.test', 4000, 'active', 'cleared', current_date + 300,
   '88888888-0000-0000-0000-000000000001'),

  ('22222222-0000-0000-0000-000000000002', 'Dani Okoro', 'dani-okoro',
   'Former academy forward. Runs the U9–U11 groups; very good with players new to structured training.',
   '+12155550102', 'dani@example.test', 4000, 'active', 'cleared', current_date + 180,
   '88888888-0000-0000-0000-000000000002'),

  ('22222222-0000-0000-0000-000000000003', 'Sam Whitfield', 'sam-whitfield',
   'Goalkeeping and defensive shape. Weekend privates.',
   '+12155550103', 'sam@example.test', 4500, 'active', 'cleared', current_date + 95,
   '88888888-0000-0000-0000-000000000003'),

  -- Applied but not cleared. Cannot be assigned to a group — the guard in 0003
  -- rejects it, which is the point of seeding them.
  ('22222222-0000-0000-0000-000000000004', 'Jordan Pace', 'jordan-pace',
   'Application in review.', '+12155550104', 'jordan@example.test', 4000,
   'pending', 'pending', null, '88888888-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into trainer_availability (trainer_id, weekday, starts_time, ends_time, location_id, kind) values
  ('22222222-0000-0000-0000-000000000001', 2, '16:00', '20:00', '11111111-0000-0000-0000-000000000001', 'group'),
  ('22222222-0000-0000-0000-000000000001', 4, '16:00', '20:00', '11111111-0000-0000-0000-000000000001', 'group'),
  ('22222222-0000-0000-0000-000000000001', 6, '09:00', '13:00', '11111111-0000-0000-0000-000000000001', 'private'),
  ('22222222-0000-0000-0000-000000000002', 1, '16:00', '20:00', '11111111-0000-0000-0000-000000000002', 'group'),
  ('22222222-0000-0000-0000-000000000002', 3, '16:00', '20:00', '11111111-0000-0000-0000-000000000002', 'group'),
  ('22222222-0000-0000-0000-000000000003', 6, '08:00', '14:00', '11111111-0000-0000-0000-000000000002', 'private'),
  ('22222222-0000-0000-0000-000000000003', 0, '09:00', '13:00', '11111111-0000-0000-0000-000000000002', 'private')
on conflict do nothing;

-- =============================================================================
-- Season
-- =============================================================================

insert into seasons (id, name, starts_on, ends_on, weeks, credits_expire_on, status)
values ('33333333-0000-0000-0000-000000000001', 'Spring 2026',
        date_trunc('week', current_date)::date + 7,
        date_trunc('week', current_date)::date + 7 + 55,
        8,
        date_trunc('week', current_date)::date + 7 + 55,
        'open')
on conflict (id) do nothing;

-- =============================================================================
-- Groups
-- =============================================================================

insert into training_groups (id, season_id, name, slug, min_age, max_age, min_skill, max_skill,
                             location_id, trainer_id, status)
values
  ('44444444-0000-0000-0000-00000000000a', '33333333-0000-0000-0000-000000000001',
   'Tue/Thu U12 Advanced', 'u12-advanced', 11, 13, 3, 5,
   '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'draft'),

  ('44444444-0000-0000-0000-00000000000b', '33333333-0000-0000-0000-000000000001',
   'Tue/Thu U10 Development', 'u10-development', 9, 11, 2, 4,
   '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'draft'),

  ('44444444-0000-0000-0000-00000000000c', '33333333-0000-0000-0000-000000000001',
   'Mon/Wed U14 Advanced', 'u14-advanced', 13, 15, 3, 5,
   '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'draft'),

  ('44444444-0000-0000-0000-00000000000d', '33333333-0000-0000-0000-000000000001',
   'Mon/Wed U9 Foundation', 'u9-foundation', 7, 9, 1, 3,
   '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'draft'),

  ('44444444-0000-0000-0000-00000000000e', '33333333-0000-0000-0000-000000000001',
   'Mon/Wed U11 Development', 'u11-development', 10, 12, 2, 4,
   '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', 'draft'),

  -- Attached to the unverified field. Stays draft; the guard will not let it open.
  ('44444444-0000-0000-0000-00000000000f', '33333333-0000-0000-0000-000000000001',
   'Tue/Thu U13 (field pending)', 'u13-pending', 12, 14, 2, 5,
   '11111111-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001', 'draft')
on conflict (id) do nothing;

-- Two meetings a week for each.
insert into group_meeting_times (group_id, weekday, starts_time, duration_minutes) values
  ('44444444-0000-0000-0000-00000000000a', 2, '17:00', 60),
  ('44444444-0000-0000-0000-00000000000a', 4, '17:00', 60),
  ('44444444-0000-0000-0000-00000000000b', 2, '16:00', 60),
  ('44444444-0000-0000-0000-00000000000b', 4, '16:00', 60),
  ('44444444-0000-0000-0000-00000000000c', 1, '18:00', 60),
  ('44444444-0000-0000-0000-00000000000c', 3, '18:00', 60),
  ('44444444-0000-0000-0000-00000000000d', 1, '16:00', 60),
  ('44444444-0000-0000-0000-00000000000d', 3, '16:00', 60),
  ('44444444-0000-0000-0000-00000000000e', 1, '17:00', 60),
  ('44444444-0000-0000-0000-00000000000e', 3, '17:00', 60),
  ('44444444-0000-0000-0000-00000000000f', 2, '18:30', 60),
  ('44444444-0000-0000-0000-00000000000f', 4, '18:30', 60)
on conflict do nothing;

-- =============================================================================
-- Households, contacts, players
-- =============================================================================

insert into households (id, display_name) values
  ('55555555-0000-0000-0000-000000000001', 'Martelli family'),
  ('55555555-0000-0000-0000-000000000002', 'Nguyen family'),
  ('55555555-0000-0000-0000-000000000003', 'Okafor family'),
  ('55555555-0000-0000-0000-000000000004', 'Brennan family'),
  ('55555555-0000-0000-0000-000000000005', 'Silva family'),
  ('55555555-0000-0000-0000-000000000006', 'Hartley family'),
  -- Browsed, has not paid. Group D is one family short and this is the family.
  -- Every checkout assertion in verify.sh runs through this household.
  ('55555555-0000-0000-0000-000000000007', 'Adeyemi family')
on conflict (id) do nothing;

-- auth_user_id would normally be filled in when the parent registers. The demo
-- sets it so the row-level security and authorisation checks can be exercised
-- as a real signed-in parent rather than as the owner of the database.
insert into contacts (household_id, auth_user_id, first_name, last_name, email, phone, is_primary,
                      sms_consent, sms_consent_at, email_consent, email_consent_at) values
  ('55555555-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'Luke',  'Martelli', 'luke.demo@example.test',  '+12155550201', true, true, now(), true, now()),
  -- Two parents, one household. The old schema could not express this without
  -- duplicating the children.
  ('55555555-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', 'Elena', 'Martelli', 'elena.demo@example.test', '+12155550202', false, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000003', 'Mai',   'Nguyen',   'mai.demo@example.test',   '+12155550203', true, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000004', 'Chidi', 'Okafor',   'chidi.demo@example.test', '+12155550204', true, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000005', 'Aoife', 'Brennan',  'aoife.demo@example.test', '+12155550205', true, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000005', '77777777-0000-0000-0000-000000000006', 'Rafa',  'Silva',    'rafa.demo@example.test',  '+12155550206', true, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000006', '77777777-0000-0000-0000-000000000007', 'Kate',  'Hartley',  'kate.demo@example.test',  '+12155550207', true, true, now(), true, now()),
  ('55555555-0000-0000-0000-000000000007', '77777777-0000-0000-0000-000000000008', 'Simi',  'Adeyemi',  'simi.demo@example.test',  '+12155550208', true, true, now(), true, now())
on conflict do nothing;

insert into players (id, household_id, first_name, last_name, birth_date, skill_level, club_team, position) values
  ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Ava',   'Martelli', current_date - interval '12 years', 4, 'Norristown SC', 'Midfield'),
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'Leo',   'Martelli', current_date - interval '9 years',  2, 'Norristown SC', 'Forward'),
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002', 'Bao',   'Nguyen',   current_date - interval '12 years', 4, 'Valley United', 'Defender'),
  ('66666666-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000003', 'Zara',  'Okafor',   current_date - interval '12 years', 5, 'Keystone FC',   'Forward'),
  ('66666666-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000004', 'Rory',  'Brennan',  current_date - interval '13 years', 3, 'Norristown SC', 'Midfield'),
  ('66666666-0000-0000-0000-000000000006', '55555555-0000-0000-0000-000000000005', 'Ines',  'Silva',    current_date - interval '12 years', 4, 'Valley United', 'Goalkeeper'),
  ('66666666-0000-0000-0000-000000000007', '55555555-0000-0000-0000-000000000006', 'Nell',  'Hartley',  current_date - interval '12 years', 3, 'Keystone FC',   'Defender'),
  ('66666666-0000-0000-0000-000000000008', '55555555-0000-0000-0000-000000000002', 'Kim',   'Nguyen',   current_date - interval '9 years',  2, 'Valley United', 'Midfield'),
  ('66666666-0000-0000-0000-000000000009', '55555555-0000-0000-0000-000000000003', 'Tunde', 'Okafor',   current_date - interval '14 years', 4, 'Keystone FC',   'Midfield'),
  ('66666666-0000-0000-0000-00000000000a', '55555555-0000-0000-0000-000000000004', 'Cara',  'Brennan',  current_date - interval '8 years',  1, '',              'Forward'),
  ('66666666-0000-0000-0000-00000000000b', '55555555-0000-0000-0000-000000000005', 'Mateo', 'Silva',    current_date - interval '14 years', 4, 'Valley United', 'Defender'),
  ('66666666-0000-0000-0000-00000000000c', '55555555-0000-0000-0000-000000000006', 'Ada',   'Hartley',  current_date - interval '13 years', 3, 'Keystone FC',   'Midfield'),
  -- Eligible for Group D and deliberately not enrolled: the fourth paid player
  -- who would activate it.
  ('66666666-0000-0000-0000-00000000000d', '55555555-0000-0000-0000-000000000007', 'Tayo',  'Adeyemi',  current_date - interval '8 years',  2, '',              'Midfield')
on conflict (id) do nothing;

commit;

-- =============================================================================
-- Open the groups whose fields are verified
-- =============================================================================
-- Group F is left in draft on purpose: its location has no verified_at, and
-- training_groups_guard_activation will reject the transition. If this block
-- ever succeeds for group F, the guard has stopped working.

update training_groups set status = 'forming'
where id in (
  '44444444-0000-0000-0000-00000000000a',
  '44444444-0000-0000-0000-00000000000b',
  '44444444-0000-0000-0000-00000000000c',
  '44444444-0000-0000-0000-00000000000d',
  '44444444-0000-0000-0000-00000000000e'
);

-- Materialise the season's sessions.
select generate_group_sessions('44444444-0000-0000-0000-00000000000a');
select generate_group_sessions('44444444-0000-0000-0000-00000000000b');
select generate_group_sessions('44444444-0000-0000-0000-00000000000c');
select generate_group_sessions('44444444-0000-0000-0000-00000000000d');
select generate_group_sessions('44444444-0000-0000-0000-00000000000e');

-- =============================================================================
-- Enrollments — the states every screen needs to render
-- =============================================================================

-- Group A: six paid → Full.
insert into enrollments (group_id, player_id, household_id, is_paid) values
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', true),
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002', true),
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000003', true),
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000006', '55555555-0000-0000-0000-000000000005', true),
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000007', '55555555-0000-0000-0000-000000000006', true),
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000004', true)
on conflict do nothing;

-- Group B: two paid → Forming. The two U9/U10 players who also train midweek.
insert into enrollments (group_id, player_id, household_id, is_paid) values
  ('44444444-0000-0000-0000-00000000000b', '66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', true),
  ('44444444-0000-0000-0000-00000000000b', '66666666-0000-0000-0000-000000000008', '55555555-0000-0000-0000-000000000002', true)
on conflict do nothing;

-- Group C: exactly four paid → sits precisely on the activation line, which is
-- the state most worth being able to look at.
insert into enrollments (group_id, player_id, household_id, is_paid) values
  ('44444444-0000-0000-0000-00000000000c', '66666666-0000-0000-0000-000000000009', '55555555-0000-0000-0000-000000000003', true),
  ('44444444-0000-0000-0000-00000000000c', '66666666-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000004', true),
  ('44444444-0000-0000-0000-00000000000c', '66666666-0000-0000-0000-00000000000b', '55555555-0000-0000-0000-000000000005', true),
  ('44444444-0000-0000-0000-00000000000c', '66666666-0000-0000-0000-00000000000c', '55555555-0000-0000-0000-000000000006', true)
on conflict do nothing;

-- Group D: three paid → Forming, one booking short. This is the group the AI
-- agent should be pushing hardest.
insert into enrollments (group_id, player_id, household_id, is_paid) values
  ('44444444-0000-0000-0000-00000000000d', '66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', true),
  ('44444444-0000-0000-0000-00000000000d', '66666666-0000-0000-0000-000000000008', '55555555-0000-0000-0000-000000000002', true),
  ('44444444-0000-0000-0000-00000000000d', '66666666-0000-0000-0000-00000000000a', '55555555-0000-0000-0000-000000000004', true)
on conflict do nothing;

-- A waitlist entry against the full group. Ada is eligible for it — a waitlist
-- of players who could not actually be enrolled would make every promotion
-- test pass for the wrong reason.
insert into waitlists (group_id, player_id, household_id, position) values
  ('44444444-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-00000000000c', '55555555-0000-0000-0000-000000000006', 1)
on conflict do nothing;

-- =============================================================================
-- A package with credits part-spent
-- =============================================================================

insert into payments (id, household_id, amount_cents, status, description, succeeded_at)
values ('77777777-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
        56000, 'succeeded', 'Spring 2026 group package — Ava', now() - interval '6 days')
on conflict (id) do nothing;

insert into packages (id, household_id, player_id, season_id, payment_id,
                      session_count, price_cents, expires_on)
select '88888888-0000-0000-0000-000000000001',
       '55555555-0000-0000-0000-000000000001',
       '66666666-0000-0000-0000-000000000001',
       '33333333-0000-0000-0000-000000000001',
       '77777777-0000-0000-0000-000000000001',
       16, 56000, s.credits_expire_on
from seasons s where s.id = '33333333-0000-0000-0000-000000000001'
on conflict (id) do nothing;

select issue_package_credits('88888888-0000-0000-0000-000000000001');

-- Spend three, so the parent dashboard shows 13 of 16 remaining.
update package_credits
set state = 'consumed', consumed_at = now() - interval '4 days'
where id in (
  select id from package_credits
  where package_id = '88888888-0000-0000-0000-000000000001'
  limit 3
);

-- =============================================================================
-- Weekend private slots — the block rule, visible
-- =============================================================================
-- Saturday morning with Sam. Three consecutive hours offered. Booking one
-- leaves it block_pending; booking a second confirms the block and creates the
-- trainer shift.

insert into private_slots (trainer_id, location_id, starts_at, ends_at, price_cents)
select '22222222-0000-0000-0000-000000000003',
       '11111111-0000-0000-0000-000000000002',
       d + t,
       d + t + interval '1 hour',
       10000
from (
  select (date_trunc('week', current_date)::date + 12)::timestamptz as d
) days
cross join (values (interval '9 hours'), (interval '10 hours'), (interval '11 hours')) as times(t)
on conflict do nothing;

-- =============================================================================
-- What this should look like when it lands
-- =============================================================================
--   Group A  full       6 paid   waitlist: 1
--   Group B  forming    2 paid
--   Group C  confirmed  4 paid   ← exactly on the line
--   Group D  forming    3 paid   ← one booking away
--   Group E  forming    0 paid
--   Group F  draft               ← blocked by the unverified field
--
-- Verify with:
--   select name, status, (group_occupancy(id)).* from training_groups order by slug;
