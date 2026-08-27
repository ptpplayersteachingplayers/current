# Decommissioning mentorship, memberships and referrals

**Decision: these three product lines are not being ported.** They have no
replacement in the new plugins.

This is the removal plan for the old codebase. Read the "Before you delete
anything" section first — three of these tables hold live training data despite
their names.

**Scope: 37 files, 21,347 lines, 19 shortcodes, 1 admin menu.**

---

## Before you delete anything

Two findings from tracing the code make this less clean than the names suggest.

### 1. The mentorship tables hold live 1-on-1 training data

`ptp_mentorship_sessions` and `ptp_mentorship_pairs` are **not** confined to the
mentorship product. They became the general storage for trainer↔player
relationships and one-on-one sessions:

- `class-ptp-off-platform-sessions.php` writes sessions with
  `session_type => 'one_on_one'` into `ptp_mentorship_sessions` whenever a
  trainer logs a session held over Zoom, by phone, or in person.
- `ptp_mentorship_pairs` is read by **14 files that are not being deleted** —
  the parent dashboard, trainer dashboard, both trainer profile templates, the
  cart, notifications, trainer tasks, and the AI assistant.

**Dropping these tables would destroy real training history.** They must be
migrated into `ptp_bookings` and `ptp_players`, not dropped. See the migration
notes below.

### 2. Referral codes are a live camp discount mechanism

`class-ptp-camp-checkout-v99.php:345` validates camp checkout codes against
`ptp_camp_referrals WHERE code = %s AND is_active = 1`. Referral codes function
as working discount codes at camp checkout today.

Before removing the referral system, **export active referral codes into the new
`ptp_discounts` table**, which covers the same job. Otherwise customers holding a
code will find it stops working at checkout.

---

## Files to delete (37)

### Mentorship — 18 files

```
includes/class-ptp-mentorship.php
includes/class-ptp-mentorship-admin.php
includes/class-ptp-mentorship-ajax.php
includes/class-ptp-mentorship-billing.php
includes/class-ptp-mentorship-content.php
includes/class-ptp-mentorship-database.php
includes/class-ptp-mentorship-hub.php
includes/class-ptp-mentorship-interest.php
includes/class-ptp-mentorship-notifications-v2.php
includes/class-ptp-mentorship-pipeline.php
includes/class-ptp-mentorship-recurring.php
includes/class-ptp-mentorship-sessions.php
includes/class-ptp-mentorship-touchpoints.php
templates/admin/mentorship-admin.php
templates/components/mentorship-components.php
templates/components/mentorship-mentee-detail.php
templates/components/mentorship-onboarding.php
templates/components/mentorship-pair-chat.php
templates/mentorship-checkout.php
templates/mentorship-checkout-section.php
templates/mentorship-dashboard.php
templates/mentorship-interest-form.php
templates/mentorship-landing.php
templates/mentorship-mentee-portal.php
templates/mentorship-signup.php
templates/mentorship-trainer-hub.php
templates/mentorship-trainer-settings.php
```

### Memberships / all-access — 5 files

```
includes/class-ptp-all-access-pass.php
templates/all-access-landing.php
templates/all-access-pass.php
templates/member-dashboard.php
templates/membership-tiers.php
```

### Referrals / loyalty — 4 files

```
includes/class-ptp-referral-system.php
includes/class-ptp-trainer-referrals.php
includes/class-ptp-trainer-loyalty.php
admin/views/camp-referrals.php
```

Also check `class-ptp-viral-engine.php` and `class-ptp-coupon-tracker.php` —
both read the referral tables and may become dead once the referral system goes.

---

## Bootstrap lines to remove

In `ptp-training-platform.php`, delete these `require_once` lines (they are
listed by their line numbers in the current file; delete bottom-up so earlier
numbers stay valid):

```
2826–2837   the twelve class-ptp-mentorship-* requires
2859–2860   the class-ptp-mentorship-hub file_exists guard and require
2926        class-ptp-trainer-loyalty.php
2927        class-ptp-trainer-referrals.php
2937        class-ptp-all-access-pass.php
2956        class-ptp-referral-system.php
```

Leave line 2955 (`class-ptp-gift-cards.php`) alone unless you also want gift
cards gone — see "Not covered by this decision" below.

---

## Shortcodes to retire (19)

Remove the WordPress pages that host them, or leave the pages and let the
shortcode render nothing. Check each against live page content first.

```
ptp_mentorship                      ptp_membership_tiers
ptp_mentorship_checkout             ptp_member_dashboard
ptp_mentorship_hub                  ptp_all_access
ptp_mentorship_interest             ptp_loyalty_dashboard
ptp_mentorship_parent_dashboard     ptp_referral_leaderboard
ptp_mentorship_portal               ptp_referral_widget
ptp_mentorship_settings             ptp_gift_cards *
ptp_mentorship_signup               ptp_gift_card_balance *
ptp_mentorship_trainer_dashboard    ptp_video_analysis *
ptp_mentorship_trainer_hub
```

\* not part of this decision — see below.

## Admin menu

Remove the `ptp-mentorship` top-level menu. `ptp-admin` is shared and stays.

---

## Database

### Safe to drop — touched only by deleted code (9 tables)

```sql
DROP TABLE wp_ptp_memberships;
DROP TABLE wp_ptp_membership_credits;
DROP TABLE wp_ptp_mentorship_challenges;
DROP TABLE wp_ptp_mentorship_messages;
DROP TABLE wp_ptp_mentorship_plans;
DROP TABLE wp_ptp_trainer_referrals;
DROP TABLE wp_ptp_service_purchases;
DROP TABLE wp_ptp_gift_cards;        -- only if dropping gift cards too
DROP TABLE wp_ptp_gift_card_usage;   -- only if dropping gift cards too
```

Take a full database backup first, and run these only after the code is removed
and the site has been stable for a release cycle. There is no urgency to drop
tables — dead tables cost nothing but a backup that is missing one costs a lot.

### Migrate, do NOT drop — holds live training data (6 tables)

```
ptp_mentorship_pairs              → trainer↔player relationships (14 live readers)
ptp_mentorship_sessions           → real 1-on-1 sessions incl. off-platform logs
ptp_mentorship_session_attendees  → who attended those sessions
ptp_mentorship_videos             → session video links
ptp_mentorship_goals              → player development goals
ptp_mentorship_milestones         → player progress
```

Fold `ptp_mentorship_sessions` into `ptp_bookings` with
`booking_type = 'training'`, preserving `trainer_id`, `player_id`,
`scheduled_at` and status. Attach goals and milestones to the player record.
Reconcile the row counts before and after.

### Do not touch — core business tables

`ptp_bookings`, `ptp_parents`, `ptp_players`, `ptp_trainers`, `ptp_reviews`,
`ptp_payouts`, `ptp_camp_bookings`, `ptp_camp_orders`, `ptp_camp_order_items`,
`ptp_unified_camp_orders`, `ptp_session_notes`, `ptp_session_recaps`,
`ptp_session_applications`, `ptp_availability_exceptions`.

### Referral tables — migrate the codes first

`ptp_referrals`, `ptp_referral_credits`, `ptp_camp_referrals` are read by camp
checkout, the coupon tracker, the viral engine and the parent dashboard. Export
any code where `is_active = 1` into the new `ptp_discounts` table before
removing, then drop.

---

## Not covered by this decision

Three things sit next to what you asked to remove but are not the same product.
Flagging rather than assuming — say the word and they go too:

| Feature | Size | Note |
|---|---|---|
| **Gift cards** (`class-ptp-gift-cards.php`) | 709 lines, 2 shortcodes | A sellable product, not a referral scheme. `class-ptp-page-creator.php` also references it. |
| **Video analysis** (`ptp_video_analysis`) | shortcode only | Registered by mentorship code, but may be sold separately. |
| **Post-booking share** (`agent-14-share-agent.php`) | 263 lines | Text-a-friend buttons on the receipt page and confirmation email. Growth feature, not a referral program with codes or rewards. |

---

## Order of work

1. Export active referral codes → `ptp_discounts`.
2. Migrate the six mentorship data tables → `ptp_bookings` / player records.
3. Verify counts, then remove the bootstrap `require_once` lines.
4. Delete the 37 files.
5. Remove the WordPress pages hosting the 19 shortcodes.
6. Run for one release cycle.
7. Drop the 9 safe tables, having taken a backup.
