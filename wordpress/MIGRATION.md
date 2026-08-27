# PTP platform rebuild — migration manifest

The old platform was five plugins, 363 PHP files and ~350,000 lines. This is
the map from that to four plugins split along one axis: **front-end pages vs
back-end pages**, with shared state in a core that renders nothing.

## The split

| Plugin | Owns | Never contains |
|---|---|---|
| **ptp-core** | Tables, repositories, Stripe, pricing, auth, email | Any markup, shortcode or admin menu |
| **ptp-public** | Customer-facing pages | Tables, Stripe calls, admin screens |
| **ptp-admin** | Staff screens | Front-end output, shortcodes |
| **ptp-marketing** | Landing pages, lead capture, attribution | Booking or payment logic |

Dependency direction is one-way: `public`, `admin` and `marketing` all depend
on `core`; core depends on nothing and never calls back into them. They
communicate through `do_action('ptp_core_ready')` and the documented hooks.

Deactivation order matters: core last.

---

## Why the old structure produced the bugs it did

Three facts from the audit drove every decision here.

1. **Seventeen tables were written by two plugins that did not know about each
   other** — including `ptp_camp_orders`, `ptp_bookings`, `ptp_parents` and
   `ptp_trainers`. That is why the codebase accumulated `camp-customer-unifier`,
   `order-totals-repair`, `invoice-verifier` and `hardcoded-backfill`: they were
   reconciling two systems fighting over the same rows. **Fix: core owns every
   table.**

2. **Fourteen checkout implementations were loaded simultaneously.** Nobody could
   say which one ran, so the same price-tampering bug was independently written
   three times. **Fix: one checkout, and pricing that has no parameter for a
   price.**

3. **Nonce checks were mistaken for authorisation.** Handlers verified the
   request came from the site, then acted on a record id from the request with
   no ownership check. **Fix: `PTP_Guard` resolves the actor from the session,
   and repositories scope reads in SQL.**

---

## Front end: 122 shortcodes → 13 pages

Every shortcode below is either kept, merged into a keeper, or dropped.
Redirects should be added for any that appear in live page content.

| Old shortcode(s) | New | Notes |
|---|---|---|
| `ptp_camps`, `ptp_find_camp`, `ptp_find_camp_v35` | `[ptp_camps]` | Three shortcodes, one listing. Filters become attributes. |
| `ptp_camp`, `ptp_camp_banner` | `[ptp_camp id=""]` | |
| `ptp_trainers_grid`, `ptp_find_trainers` | `[ptp_trainers]` | |
| `ptp_trainer_profile`, `ptp_trainer_portal` | `[ptp_trainer]` | Also served at `/trainer/{slug}`. |
| `ptp_clinics`, `ptp_group_clinics`, `ptp_clinics_strip`, `ptp_group_sessions`, `ptp_group_week`, `ptp_group_training_page` | `[ptp_clinics]` | Absorbs the standalone Group Clinics plugin's public surface. |
| `ptp_cart`, `ptp_camp_cart`, `ptp_cart_icon` | `[ptp_cart]` | |
| `ptp_checkout`, `ptp_camp_checkout`, `ptp_training_checkout`, `ptp_bundle_checkout`, `ptp_mentorship_checkout` | `[ptp_checkout]` | **The consolidation that matters most.** One flow for every product type. |
| `ptp_thank_you`, `ptp_camp_thank_you`, `ptp_camp_thankyou` | `[ptp_thank_you]` | Two spellings of one shortcode existed. |
| `ptp_login`, `ptp_forgot_password`, `ptp_reset_password` | `[ptp_login]` | Reset uses WordPress core flows. |
| `ptp_register`, `ptp_account` | `[ptp_register]` | |
| `ptp_parent_dashboard`, `ptp_my_training`, `ptp_my_training_page`, `ptp_member_dashboard`, `ptp_player_profile`, `ptp_player_progress`, `ptp_messages`, `ptp_messaging` | `[ptp_parent_dashboard]` | One account area with sections. |
| `ptp_trainer_dashboard`, `ptp_trainer_week`, `ptp_trainer_tasks`, `ptp_earnings_dashboard`, `ptp_earnings_card`, `ptp_payout_settings`, `ptp_trainer_profile_editor` | `[ptp_trainer_dashboard]` | |
| `ptp_trainer_application`, `ptp_apply`, `ptp_coach_signup`, `ptp_trainer_onboarding`, `ptp_trainer_pending` | `[ptp_trainer_application]` | Applications now land as `pending`, never `active`. |

### Dropped — decide before deleting the page

These have no replacement because they represent product lines that were built
but appear unused (no menu entry, no linked page, or a superseded experiment).
**Confirm each is genuinely dead before removing the WordPress page:**

- Membership / all-access: `ptp_membership_tiers`, `ptp_all_access`,
  `ptp_member_dashboard`, `ptp_loyalty_dashboard` — the templates were never
  referenced by the old bootstrap.
- Mentorship (9 shortcodes): `ptp_mentorship*` — a complete parallel product.
  Port only if it is still sold.
- Referral / sharing (8 shortcodes): `ptp_referral*`, `ptp_share_buttons`,
  `ptp_social_*`, `ptp_leaderboard` — rebuild as one feature if wanted.
- Landing pages: `ptp_landing_36`, `ptp_landing_v3`, `ptp_landing_warm`,
  `ptp_landing_warm_v3`, `ptp_landing_warm_v6`, `ptp_world_cup_mobile` →
  all replaced by `[ptp_landing variant=""]` in ptp-marketing.
- Diagnostics: `ptp_debug`, `ptp_group_audit` — diagnostics belong in admin.

---

## Back end: 12 menus + 85 submenus → 1 menu, 7 screens

| Old screens | New screen |
|---|---|
| `ptp-dashboard` (21 registrations), `ptp-analytics`, marketing dashboard, forecasting, economics | **Today** — the four numbers that matter, plus what needs a human |
| `ptp-schedule`, `ptp-scheduling-board`, `ptp-schedule-board`, standalone Scheduling Board plugin, `ptp-dropin-days` | **Schedule** |
| `ptp-camp-orders`, `ptp-dropin-orders`, `ptp-fix-order`, `ptp_fix_order_page`, `ptp-invoices`, `ptp-payments` | **Orders** — one list over one order table |
| `ptp-customer-hub`, `ptp-parents`, `ptp-messages`, `ptp-quo-inbox`, `ptp-hubspot-sync` | **Customers** |
| `ptp-trainers`, `ptp-applications`, `ptp-trainer-ranking`, `ptp-quality` | **Trainers** — approval is an explicit action |
| (new) | **Discounts** |
| `ptp-settings`, `ptp-admin`, `ptp-camp-products`, `ptp-camp-seats`, `ptp-session-importer`, `ptp-bug-crawler` | **Settings** |

---

## Security fixes that are structural, not patches

Each audit finding maps to a design property rather than a guard clause:

| Audit finding | Why it cannot recur |
|---|---|
| Client-controlled `amount` reaching Stripe (3 separate paths) | `PTP_Pricing::quote()` accepts only `{type, id, qty}`. `create_intent()` takes a `PTP_Quote`. Neither has a price parameter. |
| Order marked paid from a client-supplied `payment_intent_id` | Only the signature-verified webhook can call `mark_paid()`, after comparing `amount_received` against the quoted total. |
| `final_total` "verified" against client-supplied data | The quote is cached server-side and re-read by id; the client never sends a total. |
| IDOR on bookings, players, assessments, orders | Repositories scope by actor in SQL. There is no `find(int $id)` that ignores the caller. |
| Mass assignment via `$_POST` → DB row | `filter_writable()` allowlists columns; `parent_id`/`user_id` are not writable. |
| Trainer delete via bare GET (CSRF) | `PTP_Screen::handle_actions()` nonce-verifies every action regardless of method. |
| Capability implied by menu registration | `PTP_Screen::render()` checks capability itself. |
| Discount counter incremented on validation | Validation is read-only; redemption is a row with a unique `(discount_id, order_id)` index. |
| Non-atomic webhook dedup | `claim_idempotency_key()` relies on a unique index, not get-then-set. |
| FB webhook verified only if secret set | Fails closed — unset secret returns 503. |
| Stripe secret rendered in `type="text"` | Secrets are `type="password"`, never re-rendered, and prefer `wp-config.php` constants. |
| Hardcoded partner passwords | Deleted with the partner dashboard; rebuild on WordPress roles if needed. |
| `?debug` panel exposed by `||` instead of `&&` | No front-end debug surface exists. |

---

## Port order

Work one row at a time; each is independently shippable.

1. **Core + Settings** — install schema, configure Stripe keys, confirm the
   webhook receives and verifies a test event.
2. **Camps listing + detail** — read-only, no money. Proves the CPT and price
   resolver.
3. **Checkout** — the highest-value swap. Run alongside the old checkout on a
   staging site and reconcile Stripe amounts before cutting over.
4. **Thank-you + receipts.**
5. **Parent dashboard**, then **trainer dashboard**.
6. **Admin: Today, Orders, Trainers** — then Schedule and Customers.
7. **Marketing** — landing pages last; they are independent of everything else.

### Data migration

Old data must be reshaped into the new tables. It is **not** a rename:
`ptp_camp_orders` and `ptp_unified_camp_orders` both need folding into
`ptp_orders`, deduplicated on Stripe payment intent. Write that as a one-shot
WP-CLI command, run it against a copy first, and reconcile totals against
Stripe's own reporting before trusting it.

## Still to decide

- **Which old checkout is live in production.** Needed to plan the cutover and
  to know which page/shortcode customers actually hit today.
- **Whether mentorship, memberships and referrals are still sold.** They are ~15
  shortcodes and several thousand lines; if they are live they need porting, and
  if not they are the single largest deletion available.
