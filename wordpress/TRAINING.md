# The training side

Private 1-on-1 training: how a parent books a trainer, how the trainer manages
their calendar, and how money reaches them.

---

## The booking flow

```
parent picks trainer  →  picks a slot  →  slot is HELD server-side (20 min)
                                              ↓
                                       checkout (one path, web + mobile)
                                              ↓
                            Stripe webhook confirms payment received
                                              ↓
                    booking row written  →  trainer earnings ledger row
                                              ↓
                          trainer marks session delivered
                                              ↓
                            transfer to trainer's Stripe account
```

Two properties hold this together, both structural rather than checked:

**The browser never sends a price or a duration.** It sends a trainer id, a slot
start time and a player id. `PTP_Slots` re-derives the slot from the trainer's
availability rules, and `PTP_Pricing` derives the amount from the trainer's
stored hourly rate pro-rated to that slot length. There is no parameter through
which a price can enter.

**The slot survives the gap between choosing and paying, in a place the browser
cannot reach.** `PTP_Booking_Intent` holds it server-side against the session
for 20 minutes. The browser carries only an intent id.

---

## Availability

A trainer's calendar is two tables and no stored slots.

| | |
|---|---|
| `ptp_availability` | Recurring weekly blocks: "Tuesdays 16:00–20:00 at Riverside, 60-minute slots" |
| `ptp_availability_exceptions` | One-off overrides: a holiday closing a normally-open day |

**Slots are computed, never stored.** A slot table drifts out of sync the moment
anything writes a booking without going through it. Availability rules and
bookings are the only stored truth; `PTP_Slots` derives the rest on read.

Times are stored as local wall-clock, not UTC. A trainer who says "Tuesday
evenings" means 4pm local, and that should not shift when the clocks change.

Guards on what can be offered:

- **12-hour minimum notice** — trainers need warning; nothing sooner is shown.
- **45-day horizon** — a request beyond it is clamped, not honoured.
- **Trailing remainders are discarded** — a 90-minute window at 60-minute slots
  yields one slot, not one and a half.
- **Held and booked slots are excluded**, so two parents cannot buy the same
  Tuesday 5pm and one of them get a refund and an apology.

Everything a slot list shows is re-checked by `is_bookable()` before a booking
is written, because two parents can load the same page at once.

---

## Stripe mapping

```
parent pays  ──►  PTP platform account  ──►  trainer connected account
                  (keeps platform fee)       (receives net, on completion)
```

The charge is taken on the **PTP account**, not the trainer's. Deliberately:

- PTP owns the customer relationship and the refund decision.
- Money is held until the session is delivered, so a no-show is a refund rather
  than a clawback from a trainer already paid.
- One Stripe account reconciles camps, clinics and training together — which the
  old split across separate integrations never did.

| | |
|---|---|
| Platform fee | 25% default, `ptp_platform_fee_bps` option, `ptp_platform_fee_bps` filter |
| Clearance | 7 days after the session, leaving room for disputes |
| Onboarding | Stripe Express — PTP never sees a trainer's bank details, only the `acct_…` id |
| Transfer trigger | `ptp_booking_completed`, **not** `ptp_order_paid` |

The ledger row is written when the parent pays, so a trainer sees pending
earnings immediately — but no money moves until the work is done.

Idempotency at every step that touches money: the payouts table has a unique
index on `booking_id`, `mark_completed()` only transitions a *confirmed*
booking, and the Stripe transfer carries an idempotency key derived from the
booking id. A network timeout cannot pay a trainer twice.

**Fee arithmetic is tested for exact reconciliation** — `fee + net == gross` at
every amount, with no cent lost to rounding, and a misconfigured fee above 100%
or below 0% is clamped rather than inverting the split.

---

## The two portals

### Parent — `[ptp_parent_dashboard]`

Upcoming sessions, players, order history, cancel. Every read is scoped by the
repositories to the actor resolved from the session; there is no id in the page
to tamper with.

### Trainer — `[ptp_trainer_dashboard]`

Ordered by what a trainer needs on opening it:

1. **Today** — what's on
2. **Earnings** — ready to pay out / pending / paid to date, plus payout setup
3. **Mark as delivered** — confirming a past session releases its payout
4. **Coming up**
5. **When you coach** — the weekly availability editor

Both dashboards drive their AJAX through one delegated handler
(`ptp-portal.js`): a button carries `data-action`, `data-nonce` and any
`data-field-*` values. Adding an action needs no new JavaScript.

> Field names after `data-field-` must be **snake_case**. HTML lowercases
> attribute names before `dataset` sees them, so `data-field-bookingId` arrives
> as `fieldBookingid` and posts `bookingid` — a silently wrong field. Underscores
> survive; capitals do not.

---

## The mobile app

The Expo app consumes the same `ptp/v2` REST surface, through the same
repositories and the same Guard. A rule enforced for the web cannot be forgotten
for mobile.

| File | Purpose |
|---|---|
| `src/api/training.ts` | Typed `ptp/v2` client |
| `src/hooks/useTraining.ts` | React Query hooks |
| `src/screens/BookSessionScreen.tsx` | Day → time → player → hold |

**Payment hands off to the web checkout.** `holdSlot()` returns a `checkoutUrl`
the app opens; there is no in-app order-completion endpoint, deliberately — two
of the payment-bypass bugs in the old platform existed precisely because mobile
had its own.

Slot queries use a 30-second stale time and refetch on focus. Someone else may
take the slot while a parent is deciding, and finding out on the list beats
finding out after they have chosen.

### Endpoints

| Method | Route | Auth |
|---|---|---|
| GET | `/ptp/v2/trainers` | public |
| GET | `/ptp/v2/trainers/{id}` | public |
| GET | `/ptp/v2/trainers/{id}/slots` | public |
| GET | `/ptp/v2/camps` | public |
| GET | `/ptp/v2/me`, `/me/players`, `/me/bookings`, `/me/orders` | parent |
| POST | `/ptp/v2/bookings/hold` | parent |
| POST | `/ptp/v2/bookings/{id}/cancel` | parent |
| GET | `/ptp/v2/trainer/schedule`, `/trainer/earnings`, `/trainer/availability` | trainer |
| POST | `/ptp/v2/trainer/availability` | trainer |
| POST | `/ptp/v2/trainer/sessions/{id}/complete` | trainer |

Only the public catalogue routes use `__return_true`. Everything touching
customer data goes through `PTP_Guard::rest_requires()`.

---

## What is tested

`php tests/run.php` — 112 assertions, no database or WordPress install needed.

Training-specific coverage:

- **Slots (16)** — window division at 30/45/60/90 minutes, trailing remainders
  discarded, malformed windows yielding nothing rather than crashing,
  chronological ordering, horizon and notice clamping, a booked slot removed
  from the list, a blocked date clearing the day, and `is_bookable()` rejecting
  a 3am start and an off-boundary start.
- **Payouts (20)** — the fee split reconciling exactly at eight different
  amounts, configured fees honoured, and out-of-range fees clamped rather than
  inverting the split or paying out more than was taken.

## Still to build

- **Stripe Elements mount** — checkout still cannot take a card in the browser.
- **Reminder emails** before a session; only the receipt exists.
- **Trainer detail → book** deep link on the web trainer profile.
- **Refunds and cancellation policy** — cancelling a booking does not yet refund
  or reverse a pending payout row.
- Nothing here has run against a real WordPress install or the live Stripe API.
