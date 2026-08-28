-- =============================================================================
-- 0009 — System settings
-- =============================================================================
-- Every operational number, in one place, changeable without a deploy. The
-- values are the ones agreed for the first season; the point of the table is
-- that none of them are decisions made in code.
-- =============================================================================

insert into system_settings (key, value, description) values

-- ---- Group pricing ---------------------------------------------------------
('group_package_price_cents', '56000',
 'Eight-week group package: 16 sessions for $560 ($35/session).'),
('group_package_sessions', '16',
 'Sessions included in a group package.'),
('group_dropin_price_cents', '4000',
 'Single group session, $40. A group may override this on its own row.'),

-- ---- Private pricing -------------------------------------------------------
('private_hourly_price_cents', '10000',
 'What a parent pays for an hour of private training, $100.'),
('trainer_hourly_pay_cents', '4000',
 'Default trainer pay per scheduled hour, $40. Set per trainer on the trainer row; this is the fallback for new trainers.'),

-- ---- Group capacity --------------------------------------------------------
('group_min_players', '4',
 'Paid players needed to activate a group. Below this it stays Forming.'),
('group_target_players', '5',
 'The number we aim for. Advisory only — used by the AI agent when deciding which group to push.'),
('group_max_players', '6',
 'Hard cap. Beyond this, families join the waitlist.'),

-- ---- Season ----------------------------------------------------------------
('season_weeks', '8', 'Length of a standard season.'),
('sessions_per_week', '2', 'Meetings per group per week.'),

-- ---- Booking ---------------------------------------------------------------
('hold_minutes', '15',
 'How long a spot is held during checkout. Expired holds are released by the five-minute job.'),
('booking_horizon_days', '45',
 'How far ahead a parent may book.'),
('min_notice_hours', '12',
 'A session starting sooner than this is not offered — trainers need warning.'),

-- ---- Cancellation ----------------------------------------------------------
('free_cancel_hours', '24',
 'Cancel at least this far ahead for a full refund. Inside the window there is no refund and the trainer keeps the commitment.'),
('late_cancel_issues_makeup', 'false',
 'When true, a late cancellation converts the credit to a makeup rather than consuming it. Off initially — turn on if it proves kinder than it is abused.'),

-- ---- Blocks ----------------------------------------------------------------
('weekend_min_block_sessions', '2',
 'A weekend private block needs at least this many consecutive paid sessions before the trainer is committed. Never send someone across town for one hour.'),
('block_gap_minutes', '0',
 'Acceptable idle gap between sessions at the same location.'),
('travel_buffer_minutes', '30',
 'Buffer inserted when consecutive sessions are at different fields.'),
('allow_seed_private_slots', 'true',
 'Offer the first weekend private of a day as block_pending, knowing a second booking may make it viable. Turn off to only ever show slots that already join work.'),

-- ---- Waitlist --------------------------------------------------------------
('waitlist_invite_hours', '24',
 'How long a promoted family has to take a spot before it passes to the next.'),

-- ---- Automation ------------------------------------------------------------
('automation_paused', 'false',
 'THE BIG SWITCH. When true, every scheduled job and every outbound AI message stops. Set this first during an incident.'),
('ai_followup_enabled', 'true',
 'Whether the agent chases families who have not booked.'),
('reminder_hours_before', '[24, 2]',
 'Session reminders, in hours before the start.')

on conflict (key) do nothing;
