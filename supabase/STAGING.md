# The staging hour

The point of this hour is not to launch anything. It is to find out whether the
foundation is sound, because until an edge function has executed, every claim
about this platform is about code that has never run.

Nothing here touches ptpsummercamps.com. The old site keeps taking camp
registrations throughout.

---

## Before you start

You need three things:

1. **A Supabase project.** Free tier is fine. Click **Connect** in the project
   header and copy the **Session pooler** string — port 5432, not the
   transaction pooler on 6543. Migrations need session mode.
2. **Stripe test-mode keys.** Not live keys. The secret key and, after step 4,
   the webhook signing secret.
3. **The Supabase CLI.** `npm i -g supabase`, then `supabase login`.

You do *not* need Quo, HubSpot or a model key. Those belong to the agent
module, which stays off for this hour — the platform is meant to run without
it, and this is the hour that proves it.

---

## 1. Put the schema up — 5 minutes

```bash
cd supabase
./stage.sh "postgresql://postgres.yzxcfetglsbaklpburmb:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

That applies nineteen migrations and the demo season: six groups in different
states, seven families, three trainers, four 2027 camps. Use `--no-seed` if you
would rather start empty, but the demo data is what makes the next steps
checkable in a browser.

**What to check.** In the Supabase table editor, `training_groups` has six rows
and their `status` column reads `full`, `confirmed`, `forming`, `draft` —
different states, computed by the database rather than typed in.

**If it fails**, it fails on one file and stops. The error names the file and
the line. The most likely candidate is a permissions difference between your
project and a bare Postgres; send me the error.

### No CLI? Paste it instead

`./bundle.sh` splits the same SQL into six parts sized for the dashboard's SQL
editor, written to `dist/`. Open **SQL Editor** in the project, paste
`staging-part-1.sql`, run it, and only then move to part 2. The parts must run
in order and each must finish before the next starts.

They are forward-only, like the migrations they contain — running a part twice
fails on the first `CREATE TYPE`. If you need to start over, reset the database
rather than re-running a part.

This route works, but `stage.sh` is better where you can use it: it stops at
the first failure and names the file, where a paste of six files tells you only
that something in the middle went wrong.

---

## 2. Prove the rules hold there — 5 minutes

```bash
DB=ptp_verify PGHOST=... ./verify.sh
```

⚠️ **`verify.sh` drops and recreates its database.** Point it at a scratch
database, never at the one from step 1 and never at anything with real data in
it. It exists to prove the 264 assertions behave the same against real Supabase
as against local Postgres — mainly that the RLS grants do, since that is where
a hosted Postgres differs most.

---

## 3. Deploy the functions — 10 minutes

```bash
supabase link --project-ref yzxcfetglsbaklpburmb
cp .env.staging.example .env.staging   # fill in the Stripe test keys
supabase secrets set --env-file .env.staging
supabase functions deploy
```

Eight platform functions deploy. The agent module's four are not in
`functions/` unless you ran `modules/agent/install.sh install`, which is the
point of it being a module.

**What to check.** `curl https://yzxcfetglsbaklpburmb.supabase.co/functions/v1/catalog` with
your anon key returns the six groups as JSON. That is the first time any of
this code has executed. If it 500s, the log in the Supabase dashboard will say
why, and it will most likely be a column name.

---

## 4. Take one payment — 20 minutes

This is the step that matters. Everything before it is preparation.

1. Serve the site: `cd web && python3 -m http.server 8080`
2. Open `http://localhost:8080/group-training/`, pick the U9 Foundation group,
   and start a checkout.
3. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
4. Point the Stripe webhook at
   `https://yzxcfetglsbaklpburmb.supabase.co/functions/v1/stripe-webhook` and put the
   signing secret into your secrets.

**What to check, in this order:**

| | Where |
|---|---|
| A `payments` row, status `succeeded` | table editor |
| Sixteen `package_credits` rows, state `available` | table editor |
| The group's `status` moved toward `confirmed` | `training_groups` |
| The `webhook_events` row shows one claim, not two | `webhook_events` |
| The family sees it | `/my-ptp/parent/` |

`supabase/docs/BOOKING-A-PACKAGE.md` is that same purchase traced through the
database locally. If staging disagrees with that document, the difference is
the bug.

---

## 5. Build a group by hand — 10 minutes

The training side now has a write surface, so check that an administrator can
actually operate it:

```sql
select upsert_location('{"name":"Test Field","city":"Norristown","state":"PA",
                         "permit_status":"permitted"}'::jsonb);
select verify_location('<the id that came back>');
select upsert_season('{"name":"Spring 2027","starts_on":"2027-03-01","ends_on":"2027-04-26"}'::jsonb);
select upsert_training_group('{"season_id":"...","name":"Tuesday U11","location_id":"...","trainer_id":"..."}'::jsonb);
select set_group_meeting_times('<group id>','[{"weekday":2,"starts_time":"17:30"}]'::jsonb);
select publish_training_group('<group id>');
```

Run these as a **signed-in administrator**, not as the SQL editor's superuser —
the SQL editor bypasses the guards, so it proves nothing about whether a real
admin session can do this. The last call returns the group's status and how
many sessions it generated.

**What to check.** The new group appears on `/group-training/` without anything
being redeployed.

---

## What "it worked" means

The foundation is proven if: the schema applied, the assertions passed against
real Supabase, `/catalog` returned JSON, one test card produced a payment with
its credits, and a group you created by hand showed up on the public page.

That is not a launch. It leaves untouched: the data migration from the old
WordPress tables, the redirects, discount codes, training-side waivers, and
where the public site finally lives. But it converts the largest unknown in
this project — *has any of this ever run* — into a known.

## What to do if it goes wrong

Every failure in this hour is one of three kinds, and none of them is a
rethink:

- **A column name or a type.** The database is verified; the TypeScript that
  calls it is not. Send me the error.
- **A grant.** Something works locally and 403s on Supabase. That is real and
  worth knowing — it is exactly what step 2 is for.
- **Stripe shapes.** The calls are written against the documented request and
  response shapes but have never been sent.
