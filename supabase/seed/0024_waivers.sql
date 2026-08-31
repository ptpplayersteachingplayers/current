-- =============================================================================
-- 0024 — Waivers for the demo families
-- =============================================================================
-- Every demo family except one has signed. The exception is deliberate: Leo
-- Nguyen has no waiver, so the assertion that an unsigned player cannot book
-- is testing a real absence rather than a contrived one.
--
-- Signed directly rather than through record_player_waiver(), because the
-- function asserts the caller is the family and a seed file has no session.
-- =============================================================================

insert into player_waivers (
  player_id, household_id, signed_by_contact_id, signed_by_name,
  emergency_contact_name, emergency_contact_phone,
  second_contact_name, second_contact_phone,
  allergies, medical_notes,
  waiver_agreed_at, medical_auth_agreed_at, conduct_agreed_at, media_release_agreed_at,
  valid_from, expires_on)
select
  p.id,
  p.household_id,
  (select c.id from contacts c where c.household_id = p.household_id order by c.created_at limit 1),
  (select c.first_name || ' ' || c.last_name from contacts c
   where c.household_id = p.household_id order by c.created_at limit 1),
  'Emergency contact for ' || p.first_name,
  '+12155550100',
  '', '',
  case when p.first_name = 'Tayo' then 'Peanuts — carries an EpiPen in her bag' else '' end,
  case when p.first_name = 'Tayo' then 'EpiPen in the front pocket. Coaches told at the first session.' else '' end,
  now() - interval '40 days',
  now() - interval '40 days',
  now() - interval '40 days',
  case when p.first_name <> 'Nell' then now() - interval '40 days' end,
  current_date - 40,
  current_date + 325
from players p
where p.first_name <> 'Leo';

-- One player whose waiver has lapsed, so the difference between "never signed"
-- and "signed a year ago" is a state the system has actually been in. Zara is
-- chosen because no other assertion books for her — a lapsed waiver in the
-- middle of the waitlist flow would be testing two things at once.
update player_waivers
set valid_from = current_date - 400, expires_on = current_date - 35
where player_id = (select id from players where first_name = 'Zara');
