# PTP platform — development bundle

Everything needed to stand this up on a development site. __TOTAL__ assertions
pass across the database, the plugins, the portals and a real browser.

Nothing here touches ptpsummercamps.com.

```
1-wordpress-plugins/   five plugins, ready to upload
2-supabase-schema/     the database — 19 migrations, seed data, the test suite
3-agent-module/        the SMS and email agent, installed separately
4-website/             the public site and the three portals (static files)
docs/                  how each part works and what is not finished
```

---

## The order

### 1. Supabase — 10 minutes

Create a project. Click **Connect**, copy the **Session pooler** string
(port 5432, not 6543).

```bash
cd 2-supabase-schema
./stage.sh "postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

No CLI? Paste `staging-part-1.sql` … `staging-part-6.sql` into the SQL editor
in order, each one finishing before the next starts.

You should see six training groups reading `full`, `confirmed`, `forming` and
`draft` — statuses the database computed, not values that were typed in.

To prove the rules hold on your project rather than on my machine, point
`verify.sh` at a **scratch** database and run it. It drops and recreates the
database it is given, so never aim it at the one you just built.

### 2. The website — 5 minutes

`4-website/` is static: HTML, CSS and ES modules that read Supabase directly.
No build step, no npm install.

Put your project URL and publishable key in `config.js` — three values, at the
top of the file. Only public ones belong there: the anon key carries no
authority of its own, because row-level security decides every row it can
reach. Then serve it:

```bash
cd 4-website && python3 -m http.server 8080
```

Or drop the folder on Netlify, Vercel, Cloudflare Pages or any static host.

### 3. Edge functions — 10 minutes

```bash
cd 2-supabase-schema
cp .env.staging.example .env.staging     # Stripe test keys
supabase link --project-ref PROJECT
supabase secrets set --env-file .env.staging
supabase functions deploy
```

Then take one payment with `4242 4242 4242 4242`. That is the first time any
of this code executes.

### 4. WordPress plugins — separate track

`1-wordpress-plugins/` is the rebuilt WordPress side. It does not depend on
Supabase and Supabase does not depend on it. Upload at **Plugins → Add New →
Upload Plugin**, and activate **PTP Core first** — the other three hook
`ptp_core_ready` and do nothing without it.

Use a development site. Activating PTP Core runs `dbDelta` over thirteen
`wp_ptp_*` tables, four of which share names with tables the live platform
already writes to.

### 5. The agent — optional, last

```bash
cd 3-agent-module && unzip ptp-agent-module.zip
```

Then `agent/install.sh install`, or paste `ptp-agent.sql` into the SQL editor.
Deploy its four edge functions and set `AGENT_MODEL_KEY`, `QUO_WEBHOOK_SECRET`,
`EMAIL_WEBHOOK_SECRET` and `HUBSPOT_TOKEN`.

Leave it off for the first run. The platform is built to work without it, and
the first run is partly a test of whether that is true.

---

## What is proven, and what is not

**Proven.** Every business rule in the database: capacity, eligibility, money,
refunds, credits, consent, row-level security, and each attack the audit found.
Executed against real PostgreSQL, built from the migrations on every run. The
portals are asserted in real Chromium against a stubbed backend.

**Not proven.** No edge function has ever executed — there is no Deno runtime
and no Stripe, Quo, HubSpot or model credentials where this was built. Twelve
edge functions are design plus review. Step 3 above is where that changes.

`docs/STATUS.md` lists what is not built and the decisions still needed —
prices, contact details, trainer rates, the timezone rule for migrated data,
and where the public site finally lives.
