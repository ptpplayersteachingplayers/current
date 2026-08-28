# Phase 0 — Audit

**Scope of what this is.** A code-level audit of the repository. Findings marked
**[verified]** were established by reading or running code here. Findings marked
**[inferred]** are read from source but not observed running.

**What this is not.** A staging audit. I have no access to the live site, its
database, its Stripe account or its Quo/HubSpot connections, so nothing below
confirms that any of it *currently works in production*. Every item that needs a
live environment is listed in "Still to verify" at the end, and none of it should
be treated as settled until someone runs it.

No production changes were made.

---

## 1. What can be reused

Business logic worth porting to Postgres, in rough order of value. These are
algorithms and rules, not framework code — the framework goes.

| Source | Lines | What is worth keeping |
|---|---|---|
| `class-ptp-cancellation-policy.php` | 123 | The refund/payout **pairing rule**, and the decision that a late cancellation still pays the trainer. Ports almost verbatim to a Postgres function. **[verified by test]** |
| `class-ptp-connect.php` | 431 | The fixed-per-trainer payout model, the clearance window, and the "payout exceeds charge" flag. The Stripe Connect call shapes carry over unchanged. |
| `class-ptp-stripe.php` | 413 | Webhook signature verification with replay window, and idempotency-key discipline on transfers and refunds. **[verified by test]** — port the *approach*, not the PHP. |
| `class-ptp-refunds.php` | 244 | The reverse-payout-then-refund ordering, and partial/cumulative refunds scaled by what was actually paid. |
| `class-ptp-pricing.php` | 223 | Server-authoritative pricing: the resolver pattern where a caller passes item references and never a price. This is the single most valuable idea to carry across. |
| `class-ptp-slots.php` | 333 | **Structure only.** Window-splitting, notice and horizon clamping are reusable; the isolated-slot model is being deliberately inverted, so the offering logic is discarded. |

Also reusable: the design tokens (`ptp-tokens.css`), the parent and trainer
screen layouts, and the 147 test cases as a specification of intended behaviour
even though the implementations change.

---

## 2. What should remain temporarily

**The entire WordPress private-training stack stays live and untouched** until
the Supabase group system is proven. Specifically:

- Camps and clinics checkout — unrelated to this rebuild, still earning.
- Private training booking, as it stands today.
- The Stripe webhook currently receiving events.
- Landing pages and ad tracking (`ptp-marketing`) — genuinely standalone, no reason to move it.

**Rule going forward:** no new business logic lands in the WordPress plugins.
Bug fixes only. Every new rule goes to Supabase.

---

## 3. What will be replaced

| Replaced | By |
|---|---|
| `PTP_Slots` isolated-slot engine | Block-based scheduling: groups anchor blocks, privates attach to them |
| `PTP_Booking_Intent` (20-min cookie hold) | `booking_holds` table, 15 minutes, server-side, expiring by job |
| `ptp_bookings` / `ptp_orders` (MySQL) | Postgres `bookings`, `enrollments`, `payments` |
| WordPress user auth + `PTP_Guard` | Supabase Auth + Row Level Security |
| Ad-hoc `ptp_events` table | `audit_logs`, append-only, with an actor on every row |
| Hourly reminder cron | Four job tiers with a global automation pause |

---

## 4. Integrations that already function

**[inferred — configuration exists in code, live status unconfirmed]**

| Integration | Evidence | Read |
|---|---|---|
| **Stripe** | Keys read from constants or options; webhook route registered; signature verification tested | Almost certainly live. The account and its history are the thing being migrated *around*, not replaced. |
| **OpenPhone / Quo** | `ptp_camps_openphone_api_key` and `_from` stored; a webhook with HMAC verification exists in the legacy camps plugin | Credentials are wired. Whether the number and webhook are currently active needs checking. |
| **HubSpot** | `hubspot_access_token` and `hubspot_api_key` present in the legacy platform | A token exists. The sync was deliberately not ported, so the mapping has to be rebuilt regardless. |
| **Meta / Google Ads** | Pixel ids, conversion labels, access tokens all stored | Marketing-side only. Out of scope for this rebuild; leave running. |
| **Google Maps** | API key stored | Useful later for field addresses. |

---

## 5. Data that needs migrating

Ordered by risk. Counts are unknown — I cannot query the database.

**Tier 1 — customer identity. Migrate first, deduplicate carefully.**

- `ptp_parents` (referenced by 127 files) → `households` + `contacts`
- `ptp_players` (94 files) → `players`
- `ptp_trainers` (194 files) → `trainers`

The old schema has no household concept — a parent *is* the account. Splitting
one parent row into a household plus a contact is the migration's first real
decision, and two parents sharing children will surface duplicates that were
invisible before.

**Tier 2 — money. Reconcile against Stripe, never against the old tables.**

- `ptp_camp_orders`, `ptp_unified_camp_orders` (58 files) — the split that made
  revenue unreliable. Fold on Stripe payment intent, which is the only
  trustworthy key.
- `ptp_payouts` — trainer payment history.

**Tier 3 — history. Migrate for continuity, not for operations.**

- `ptp_bookings` (152 files) and `ptp_camp_bookings` (40)
- `ptp_mentorship_sessions` / `ptp_mentorship_pairs` — **these hold live 1-on-1
  training data despite the name.** Established earlier: off-platform session
  logging writes real sessions here, and 14 non-mentorship files read the pairs
  table. They map to `bookings` and to trainer↔player relationships.
- `ptp_session_notes`, `ptp_reviews`, `ptp_availability`

---

## 6. Conflicts and risks

**Two systems taking money at once.** While both stacks run, Stripe receives
webhooks that two codebases may try to handle. Mitigation: the Supabase webhook
processes only events carrying its own metadata namespace, and both write to a
shared `webhook_events` idempotency table keyed on the Stripe event id. This
needs settling before the first Supabase payment, not after.

**Trainer identity across two systems.** A trainer may exist in WordPress with a
Stripe Connect `acct_` id and again in Supabase. The `acct_` id is the join key
and must be copied, never regenerated — a second onboarding creates a second
account and splits their payment history.

**"Group session" does not exist in the old data.** Nothing to migrate, but also
nothing to validate against. The first season is built from scratch, which is
lower risk than it sounds.

**Package credits have no precedent.** Same — greenfield, and the accounting
should be got right before any money is taken against it.

**Back-to-back blocks change what a trainer already agreed to.** Trainers
currently accept isolated bookings. Moving to blocks changes their working
pattern, and existing accepted bookings under the old rule must be honoured.
The migration should not retro-apply block rules to bookings already made.

**Availability semantics differ.** Old rules are wall-clock local with no
timezone column. Postgres `timestamptz` will want a zone. Getting this wrong
shifts every session by an hour twice a year.

**RLS is not the same shape as the Guard class.** The current model resolves an
actor and scopes queries in SQL. RLS enforces at the row level for every client,
including ones that do not exist yet. It is stricter and better — but a policy
gap fails open in a way the Guard did not, so policies need testing as
adversarially as the payment code was.

---

## 7. Still to verify — needs a live environment

None of these can be settled from the repository:

1. Whether the Stripe account is in live or test mode, and which webhook
   endpoints are currently registered.
2. Whether the Quo/OpenPhone number is active and its webhook reachable.
3. Whether the HubSpot token is still valid and what its object mapping is.
4. Actual row counts and duplicate rates in `ptp_parents`, `ptp_players`, `ptp_trainers`.
5. How many trainers have a Stripe Connect account already onboarded.
6. Which WordPress pages are live and which shortcodes they carry.
7. Whether WP-Cron is firing reliably, which determines how much the new job
   tiers can depend on it during the transition.

**Recommendation:** answer 1, 4 and 5 before the first migration is written.
The others can wait until Phase 4.
