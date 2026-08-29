# Edge functions

The API layer over the database. Every one of them is thin on purpose: the
rules live in SQL, where they cannot be forgotten by the next endpoint someone
adds.

## The trust boundary

Two clients, and choosing between them is a security decision:

| | Key | RLS | Used by |
|---|---|---|---|
| `asCaller(req)` | the caller's own token | applies | everything a browser triggers |
| `asService()` | service role | **bypassed** | `stripe-webhook`, `jobs`, and the Stripe half of `checkout` and `cancel-booking` |

A handler that reaches for `asService()` to make an error go away has moved a
family's data outside every policy protecting it. The rule is: use the caller's
token unless there is no caller.

Secrets — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `PTP_JOB_SECRET` — are read from the environment
inside the function and never appear in a response. The only Stripe value that
reaches the browser is a PaymentIntent's `client_secret`, which is scoped to
that one payment.

## Endpoints

| | Method | What it does |
|---|---|---|
| `catalog` | GET | The public season, its groups, how full each is. Anon key, so the catalogue policies decide what is visible. |
| `checkout` | POST | Prices server-side, holds a place, creates a PaymentIntent. |
| `stripe-webhook` | POST | Verifies, claims, settles. The only thing that turns money into a place. |
| `book-with-credit` | POST | Spends a credit. No money moves, so no Stripe. |
| `cancel-booking` | POST | Applies the policy, refunds if due, records the refund. |
| `waitlist` | POST | `join`, `accept` or `decline`. Accepting returns a checkout, not a place. |
| `attendance` | POST | A whole roster in one request, upserted. Does not affect pay. |
| `jobs` | POST | Runs a tier. Authenticated by a shared secret — there is no user. |

## Idempotency, in three layers

1. **`begin_checkout()`** is unique on `(household, idempotency_key)`. A double
   tap gets the same intent row, not a second hold.
2. **Stripe's `Idempotency-Key`** is derived from that intent's id. A retry
   after a network timeout returns the original PaymentIntent rather than
   creating a second one we would never learn about.
3. **`claim_webhook_event()`** returns true exactly once per Stripe event id,
   and `settle_checkout()` is idempotent underneath it anyway.

They fail differently, which is why there are three.

## Environment

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
PTP_JOB_SECRET
PTP_ALLOWED_ORIGINS        comma-separated; CORS is an allow-list, not "*"
```

## Deploying

```bash
supabase functions deploy checkout
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe has no user token
supabase functions deploy jobs           --no-verify-jwt   # nor does the scheduler
```

`stripe-webhook` and `jobs` authenticate themselves — the first by HMAC over
the raw body, the second by a shared secret compared in constant time. The
rest require a Supabase JWT.

Point the scheduler at:

```
POST /functions/v1/jobs?tier=five_minute     every 5 minutes
POST /functions/v1/jobs?tier=hourly          hourly
POST /functions/v1/jobs?tier=daily           daily
```

with `x-ptp-job-secret`. What each tier contains is `jobs_for_tier()` in the
database, so the schedule changes without a deploy.

## What is tested

`tests/signature.test.mjs` imports `_shared/signature.ts` directly — the same
source the edge runtime executes — and checks twelve cases: a tampered body, a
foreign secret, a replay outside the tolerance, a timestamp from the future,
a secret mid-rotation, and so on.

The handlers themselves are not tested. They have no Deno runtime here and no
Stripe account to talk to, so what is written about them is design, not a
verified claim. The business rules underneath them *are* tested, by
`../verify.sh`, against a real PostgreSQL 16.
