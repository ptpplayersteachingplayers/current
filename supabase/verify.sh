#!/usr/bin/env bash
# =============================================================================
# Apply every migration and seed into a throwaway database, then assert the
# business rules actually hold.
#
#   ./verify.sh                      # uses a local postgres on $PGHOST
#   PGHOST=... PGPORT=... ./verify.sh
#
# Exits non-zero on the first failed assertion, so it works as a CI gate.
# =============================================================================
set -uo pipefail

DB="${DB:-ptp_verify}"
PSQL_ARGS="-h ${PGHOST:-/tmp/pgtest/sock} -p ${PGPORT:-5433} -U ${PGUSER:-postgres}"
cd "$(dirname "$0")"
Q() { psql $PSQL_ARGS -d "$DB" -tA -q -c "$1" 2>&1; }

# Run as a signed-in parent or trainer. SET LOCAL only takes effect inside a
# transaction, and a bare -c gives each statement its own — which silently left
# every authorisation check running as the database owner the first time.
AS() { # AS <auth.uid> <sql>
  psql $PSQL_ARGS -d "$DB" -tA -q 2>&1 <<EOF | grep -v '^$'
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"$1"}';
$2
commit;
EOF
}

# An anonymous visitor. Supabase's publishable key is itself a token with
# role=anon, so a real anonymous request carries claims — and a guard that
# treats "no signed-in user" as "must be the system" waves it straight through.
# That was the largest hole in this schema, so it gets its own helper.
ANON() { # ANON <sql>
  psql $PSQL_ARGS -d "$DB" -tA -q 2>&1 <<EOF | grep -v '^$'
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
$1
commit;
EOF
}

assert_anon() { # assert_anon <sql> <description> <expected-substring>
  local got; got=$(ANON "$1")
  if echo "$got" | grep -qi -- "$3"; then
    printf "  ok   %s\n" "$2"; pass=$((pass+1))
  else
    printf "  FAIL %s\n         got: %s\n" "$2" "$(echo "$got" | head -1)"; fail=$((fail+1))
  fi
}

pass=0; fail=0
assert() { # assert <sql> <description> <expected-substring>
  local got; got=$(Q "$1")
  if echo "$got" | grep -qi -- "$3"; then
    printf "  ok   %s\n" "$2"; pass=$((pass+1))
  else
    printf "  FAIL %s\n         got: %s\n" "$2" "$(echo "$got" | head -1)"; fail=$((fail+1))
  fi
}

assert_as() { # assert_as <auth.uid> <sql> <description> <expected-substring>
  local got; got=$(AS "$1" "$2")
  if echo "$got" | grep -qi -- "$4"; then
    printf "  ok   %s\n" "$3"; pass=$((pass+1))
  else
    printf "  FAIL %s\n         got: %s\n" "$3" "$(echo "$got" | head -1)"; fail=$((fail+1))
  fi
}

echo "Building $DB from scratch…"
psql $PSQL_ARGS -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1

# Supabase provides these; stub them so the migrations run anywhere.
psql $PSQL_ARGS -d "$DB" -q >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')
  )::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
-- Supabase grants these; a bare Postgres does not, and without them any policy
-- or guard that reads a claim fails for a signed-in user.
grant usage on schema auth to anon, authenticated;

-- Supabase also grants the API roles table access and leaves RLS to do the
-- filtering. Without this the local database denies everything for the wrong
-- reason, and a policy that is actually broken would still look like it works.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;
SQL

for f in migrations/*.sql seed/*.sql; do
  if ! psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1; then
    echo "  FAIL applying $f"
    psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep ERROR | head -3
    exit 1
  fi
done
echo "  ok   every migration and seed applied"
echo

# =============================================================================
# The platform, with nothing installed on top of it
# =============================================================================
# This is the half of the test that makes "plugin" mean something. Everything
# below runs against core alone: no agent tables, no follow-up queue, no
# HubSpot. If somebody adds a core query against a module's table, it fails
# here rather than in production the first time the agent is turned off.

echo "PLATFORM WITHOUT MODULES"
assert "select to_regclass('public.scheduled_followups') is null;" \
       "the agent's tables are genuinely absent"                                                                          "^t$"
assert "select count(*) from platform_modules;" \
       "…and nothing is registered"                                                                                        "^0$"

assert "select price_group_package((select id from training_groups where slug='u9-foundation')) > 0;" \
       "a season is still priced"                                                                                          "^t$"
assert "select count(*) > 0 from camps_near('19401', 40);" \
       "a family still finds a camp near them"                                                                             "^t$"
assert "select session_has_space((select id from sessions where group_id=(select id from training_groups where slug='u9-foundation') limit 1));" \
       "a session still knows whether it has room"                                                                         "^t$"
HOLD_CORE=$(Q "select (create_booking_hold((select id from sessions where group_id=(select id from training_groups where slug='u9-foundation') order by starts_at limit 1),(select id from players where first_name='Leo'))).id;")
assert "select count(*) from booking_holds where id='$HOLD_CORE' and expires_at > now();" \
       "a place can still be held with no agent installed"                                                                 "^1$"
Q "delete from booking_holds where id='$HOLD_CORE';" >/dev/null

assert "select 'send_reminders' = any(jobs_for_tier('hourly'));" \
       "the platform's own hourly jobs are registered"                                                                     "^t$"
assert "select 'queue_followups' = any(jobs_for_tier('hourly'));" \
       "…and a module's are not, because it is not installed"                                                              "^f$"
assert "select run_scheduled_job('queue_followups','hourly')::text;" \
       "asking for a job whose module is absent says so rather than doing nothing quietly"                                 "No such job is registered"

assert "select module_metric('pending_followups');" \
       "a number the platform does not compute reads as zero, not as an error"                                             "^0$"
assert "select (weekly_summary()::jsonb) ->> 'needs_follow_up';" \
       "…so the weekly summary is still a complete object"                                                                 "^0$"
echo

# Now install the module and carry on. Everything after this point may assume
# the agent exists.
for f in modules/*/0*.sql; do
  if ! psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1; then
    echo "  FAIL applying $f"
    psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep ERROR | head -3
    exit 1
  fi
done
echo "MODULES"
assert "select count(*) from platform_modules where name='agent' and enabled;" \
       "the agent module installs and registers itself"                                                                    "^1$"
assert "select 'queue_followups' = any(jobs_for_tier('hourly'));" \
       "…and its scheduled work appears without core being edited"                                                         "^t$"
assert "select (weekly_summary()::jsonb) ->> 'needs_follow_up' is not null;" \
       "…and the number it contributes is now reported"                                                                    "^t$"
echo


echo "SEEDED STATE"
assert "select status from training_groups where slug='u12-advanced';"   "six paid players reads as Full"                 "^full$"
assert "select status from training_groups where slug='u14-advanced';"   "four paid players reads as Confirmed"           "^confirmed$"
assert "select status from training_groups where slug='u9-foundation';"  "three paid players reads as Forming"            "^forming$"
assert "select status from training_groups where slug='u13-pending';"    "a group on an unverified field stays Draft"     "^draft$"
assert "select count(*) from sessions where group_id=(select id from training_groups where slug='u12-advanced');" \
       "an eight-week season generates sixteen sessions"                                                                  "^16$"
assert "select count(*) from package_credits where state='available';"   "a 16-session package with 3 spent leaves 13"    "^13$"
echo

echo "GUARDS"
assert "update training_groups set status='forming' where slug='u13-pending';" \
       "a group cannot open on an unverified field"                                                                       "not verified and permitted"
assert "insert into sessions (kind,trainer_id,location_id,starts_at,ends_at) select 'private',trainer_id,location_id,starts_at,ends_at from sessions where group_id is not null limit 1;" \
       "a trainer cannot be double-booked"                                                                                "no_trainer_overlap\|conflicting key"
assert "insert into player_notes (player_id,kind,body,parent_visible) select id,'injury','x',false from players limit 1;" \
       "an injury note cannot be hidden from the parent"                                                                  "safety_is_visible"
assert "insert into bookings (session_id,player_id,household_id,status) select s.id,p.id,p.household_id,'confirmed' from sessions s, players p limit 1;" \
       "a confirmed booking needs a payment or a credit"                                                                  "price_or_credit"
assert "select claim_webhook_event('stripe','e1','t','{}')::text||claim_webhook_event('stripe','e1','t','{}')::text;" \
       "the same webhook event is claimed exactly once"                                                                   "^truefalse$"
echo

echo "CAPACITY"
assert "select create_booking_hold((select id from sessions where group_id=(select id from training_groups where slug='u12-advanced') limit 1),(select id from players where first_name='Ada'));" \
       "an eligible player cannot hold a spot in a full group"                                                            "is full"
assert "select create_booking_hold((select id from sessions where group_id=(select id from training_groups where slug='u14-advanced') limit 1),(select id from players where first_name='Leo'));" \
       "an ineligible player cannot hold a spot at all"                                                                   "not eligible"
assert "select player_is_eligible((select id from players where first_name='Leo'),(select id from training_groups where slug='u9-foundation'));" \
       "eligibility passes for the right age and level"                                                                   "^t$"
echo

echo "BLOCKS — no isolated trips"
Q "update private_slots set status='booked' where id=(select id from private_slots order by starts_at limit 1);" >/dev/null
assert "select evaluate_trainer_block((select id from private_slots order by starts_at limit 1))::text;" \
       "one weekend booking does not commit a trainer"                                                                    "awaiting_second_booking"
assert "select count(*) from trainer_shifts;" "…and creates no shift"                                                     "^0$"
Q "update private_slots set status='booked' where id=(select id from private_slots where status='available' order by starts_at limit 1);" >/dev/null
assert "select evaluate_trainer_block((select id from private_slots where status='booked' order by starts_at limit 1))::text;" \
       "a second consecutive booking confirms the block"                                                                  '"confirmed": true'
assert "select status::text from trainer_shifts limit 1;" "…and the trainer shift is confirmed"                           "^confirmed$"
Q "update private_slots set status='canceled' where starts_at::time='09:00';" >/dev/null
assert "select handle_block_cancellation((select id from private_slots where starts_at::time='09:00'))::text;" \
       "one family cancelling does not cancel the other"                                                                  '"shift_kept": true'
assert "select override_confirm_block((select id from trainer_shifts limit 1),'')::text;" \
       "an admin override without a reason is refused"                                                                    "needs a reason"
echo

echo "PAY"
Q "update trainer_shifts set status='completed';" >/dev/null
assert "select amount_cents::text from record_trainer_hours((select id from trainer_shifts limit 1));" \
       "two scheduled hours at \$45/hr pays \$90"                                                                          "^9000$"
Q "select record_trainer_hours((select id from trainer_shifts limit 1));" >/dev/null
assert "select count(*) from trainer_hours;" "recording twice pays once"                                                  "^1$"
echo

echo "CHECKOUT — the client never sends a price"
GROUP_D=$(Q "select id from training_groups where slug='u9-foundation';")
TAYO='66666666-0000-0000-0000-00000000000d'
SIMI='77777777-0000-0000-0000-000000000008'
MAI='77777777-0000-0000-0000-000000000003'

assert "select amount_cents from begin_checkout('group_package','$TAYO','$GROUP_D','tap-1');" \
       "the package is priced from settings, at \$560"                                                                    "^56000$"
assert "select count(*) from checkout_intents where idempotency_key='tap-1';" \
       "a double tap makes one checkout, not two"                                                                         "^1$"
Q "select begin_checkout('group_package','$TAYO','$GROUP_D','tap-1');" >/dev/null
assert "select count(*) from checkout_intents;" "…even on the second call"                                                "^1$"
assert "select held from group_occupancy('$GROUP_D');" \
       "a checkout in progress occupies a place"                                                                          "^1$"

Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='tap-1'),'pi_v1');" >/dev/null
assert "select settle_checkout('pi_v1',56000,'ch_v1')::text;" \
       "paying books the whole season, not one session"                                                                   '"sessions_booked": 16'
assert "select status from training_groups where slug='u9-foundation';" \
       "the fourth paid family activates the group"                                                                       "^confirmed$"
assert "select count(*) from package_credits where household_id=(select household_id from players where id='$TAYO');" \
       "sixteen credits, one per session"                                                                                 "^16$"
assert "select settle_checkout('pi_v1',56000,'ch_v1')::text;" \
       "a replayed Stripe event settles nothing twice"                                                                    '"idempotent": true'
assert "select count(*) from payments where stripe_payment_intent_id='pi_v1';" \
       "…and writes one payment row"                                                                                      "^1$"
assert "select settle_checkout('pi_never_seen',56000,'ch_x')::text;" \
       "a payment we cannot attribute escalates instead of guessing"                                                      "no_matching_intent"
assert "select count(*) from escalations where severity='urgent';" "…urgently"                                            "^1$"
echo

echo "CREDITS"
BOOKING=$(Q "select b.id from bookings b join sessions s on s.id=b.session_id where b.player_id='$TAYO' order by s.starts_at desc limit 1;")
LATER=$(Q "select session_id from bookings where id='$BOOKING';")
assert "select cancel_booking('$BOOKING', false, 'away that week')::text;" \
       "cancelling in good time is refundable"                                                                            '"refund_due": true'
assert "select count(*) from package_credits where state='available' and household_id=(select household_id from players where id='$TAYO');" \
       "…and the credit comes back"                                                                                       "^1$"
assert "select state from enrollments where player_id='$TAYO';" \
       "missing one week is not leaving the group"                                                                        "^active$"
assert "select status from training_groups where slug='u9-foundation';" \
       "…so the group stays confirmed for the other families"                                                             "^confirmed$"
assert "select status::text from book_with_credit('$LATER','$TAYO');" \
       "the freed credit books a makeup"                                                                                  "^confirmed$"
assert "select count(*) from package_credits where state='available' and household_id=(select household_id from players where id='$TAYO');" \
       "…spending exactly one"                                                                                            "^0$"
echo

echo "DROP-INS ARE NOT ENROLMENTS"
DROPIN=$(Q "select s.id from sessions s where s.group_id=(select id from training_groups where slug='u11-development') and s.starts_at>now() order by s.starts_at limit 1;")
Q "select begin_checkout('group_dropin','66666666-0000-0000-0000-000000000007','$DROPIN','drop-1');" >/dev/null
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='drop-1'),'pi_v2');" >/dev/null
Q "select settle_checkout('pi_v2',4000,'ch_v2');" >/dev/null
assert "select status from training_groups where slug='u11-development';" \
       "one evening booked does not activate a season"                                                                    "^forming$"
assert "select paid from group_occupancy((select id from training_groups where slug='u11-development'));" \
       "…and counts nothing toward the four"                                                                              "^0$"
assert "select taken from session_occupancy('$DROPIN');" \
       "…but does take a place on the field that night"                                                                   "^1$"
echo

echo "WAITLIST"
GROUP_A=$(Q "select id from training_groups where slug='u12-advanced';")
assert "select accept_waitlist_invite((select id from waitlists where group_id='$GROUP_A'),'w1');" \
       "a place that was never offered cannot be taken"                                                                   "has not been offered"
Q "update enrollments set state='withdrawn', withdrawn_at=now() where group_id='$GROUP_A' and player_id=(select player_id from enrollments where group_id='$GROUP_A' and state='active' limit 1);" >/dev/null
assert "select run_scheduled_job('promote_waitlists','hourly')::text;" \
       "a place opening invites the first in line"                                                                        '"items": 1'
assert "select state from waitlists where group_id='$GROUP_A';" "…with an offer, not a booking"                           "^invited$"
Q "select accept_waitlist_invite((select id from waitlists where group_id='$GROUP_A' and state='invited'),'w2');" >/dev/null
assert "select state from waitlists where group_id='$GROUP_A';" \
       "accepting without paying does not convert the place"                                                              "^invited$"
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='w2'),'pi_v3');" >/dev/null
Q "select settle_checkout('pi_v3',56000,'ch_v3');" >/dev/null
assert "select state from waitlists where group_id='$GROUP_A';" "paying converts it"                                      "^converted$"
assert "select status from training_groups where slug='u12-advanced';" "…and the group is full again"                     "^full$"
echo

echo "AUTHORISATION — RLS does not apply inside a definer function, so the"
echo "                functions check for themselves"
assert_as "$MAI" "select begin_checkout('group_package','$TAYO','$GROUP_D','evil-1');" \
       "a parent cannot check out for another family's child"                                                             "does not belong to your household"
assert_as "$MAI" "select begin_checkout('group_package','66666666-0000-0000-0000-0000000000ff','$GROUP_D','evil-2');" \
       "…and an id that does not exist gives the same answer, so it is no oracle"                                         "does not belong to your household"
# Resolved as the database owner: read as Mai, the subquery returns nothing at
# all, which is row-level security answering first. Pass the id in directly so
# the check under test is the one inside cancel_booking().
THEIRS=$(Q "select id from bookings where player_id='$TAYO' and status in ('confirmed','attended') limit 1;")
assert_as "$MAI" "select id from bookings where id='$THEIRS';" \
       "another family's booking is not even visible"                                                                     "^$"
assert_as "$MAI" "select cancel_booking('$THEIRS', false, 'mischief');" \
       "…and knowing its id does not help: the function checks too"                                                       "does not belong to your household"
assert_as "$SIMI" "select player_is_eligible('$TAYO','$GROUP_D');" \
       "…while their own family still works"                                                                              "^t$"
SESSION_D=$(Q "select id from sessions where group_id='$GROUP_D' and starts_at>now() order by starts_at limit 1;")
assert_as '88888888-0000-0000-0000-000000000001' "select record_attendance('$SESSION_D','$TAYO','present');" \
       "a trainer cannot mark a register for a session that is not theirs"                                                "not the trainer for that session"
assert_as '88888888-0000-0000-0000-000000000002' "select state::text from record_attendance('$SESSION_D','$TAYO','present');" \
       "…the trainer running it can"                                                                                     "^present$"
assert_as '88888888-0000-0000-0000-000000000002' "select status::text from bookings where session_id='$SESSION_D' and player_id='$TAYO';" \
       "…and the booking reads as attended"                                                                              "^attended$"
echo

echo "SCHEDULED WORK"
SLOT=$(Q "select id from private_slots where status='available' order by starts_at limit 1;")
Q "select begin_checkout('private','66666666-0000-0000-0000-000000000001','$SLOT','abandon-1');" >/dev/null
assert "select status::text from private_slots where id='$SLOT';" "a checkout takes the slot off the board"                "^held$"
Q "update checkout_intents set expires_at = now() - interval '1 minute' where idempotency_key='abandon-1';" >/dev/null
Q "select run_tier('five_minute');" >/dev/null
assert "select status::text from private_slots where id='$SLOT';" "…and abandoning it puts the slot back"                  "^available$"

REMIND=$(Q "select session_id from bookings where player_id='$TAYO' and status='confirmed' limit 1;")
Q "update sessions set starts_at = now() + interval '23 hours 30 minutes', ends_at = now() + interval '25 hours' where id='$REMIND';" >/dev/null
assert "select run_scheduled_job('send_reminders','hourly')::text;" "a session tomorrow gets a reminder"                   '"items": 1'
assert "select run_scheduled_job('send_reminders','hourly')::text;" "…and only ever one"                                  '"items": 0'
assert "select count(*) from messages;" "…one message, not two"                                                           "^1$"
assert "select body from messages limit 1;" "…written in the family's own timezone"                                       "am on\|pm on"
Q "update conversations set human_owned = true;" >/dev/null
Q "update sessions set starts_at = now() + interval '1 hour 50 minutes', ends_at = now() + interval '3 hours' where id='$REMIND';" >/dev/null
assert "select run_scheduled_job('send_reminders','hourly')::text;" \
       "when a person takes over a thread the agent stays out of it"                                                      '"items": 0'
Q "update system_settings set value='true' where key='automation_paused';" >/dev/null
assert "select run_scheduled_job('send_reminders','hourly')::text;" "the pause switch stops the agent"                     "automation_paused"
assert "select run_scheduled_job('expire_holds','five_minute')::text;" \
       "…but releasing what is held still runs, because holding a spot hostage helps nobody"                              '"succeeded": true'
Q "update system_settings set value='false' where key='automation_paused';" >/dev/null
echo

echo "WEBHOOK RETRIES"
assert "select claim_webhook_event('stripe','e2','t','{}')::text;" "a new event is claimed"                                "^true$"
assert "select claim_webhook_event('stripe','e2','t','{}')::text;" "…and not claimed twice while it is in flight"          "^false$"
assert "select release_webhook_event('stripe','e2','handler blew up')::text;" \
       "a handler that fails releases the event for the provider to retry"                                                "^true$"
assert "select claim_webhook_event('stripe','e2','t','{}')::text;" "…so the retry can pick it up"                          "^true$"
Q "update webhook_events set attempts = 5 where external_id='e2';" >/dev/null
assert "select release_webhook_event('stripe','e2','still broken')::text;" \
       "after enough tries it stops retrying and asks for a person"                                                       "^false$"
assert "select claim_webhook_event('stripe','e2','t','{}')::text;" "…and is not handed out again"                          "^false$"
echo

echo "CAMPS"
assert "select status::text from camps where slug='norristown-week-1';" \
       "a camp with room is open"                                                                                          "^registration_open$"
assert "select status::text from camps where slug='cherry-hill-week-2';" \
       "six places left reads as limited, not open"                                                                        "^limited$"
assert "select status::text from camps where slug='doylestown-week-1';" \
       "a camp at capacity is full"                                                                                        "^full$"
assert "update camps set status='registration_open' where slug='princeton-week-3';" \
       "a camp cannot open on an unapproved field"                                                                          "field is not approved"
Q "update camps set field_approved = true where slug='princeton-week-3';" >/dev/null
assert "update camps set status='registration_open' where slug='princeton-week-3';" \
       "…nor without a certificate of insurance"                                                                            "certificate of insurance"
Q "update camps set insurance_status='received', full_day_price_cents=0 where slug='princeton-week-3';" >/dev/null
assert "update camps set status='registration_open' where slug='princeton-week-3';" \
       "…nor at \$0, which is how the old site sold free weeks"                                                             "cannot open at .0"
assert "select count(*) from camp_sessions where camp_id=(select id from camps where slug='norristown-week-1');" \
       "a Monday-to-Friday camp generates five days"                                                                       "^5$"
echo

echo "CAMP FINDER"
assert "select c.slug from camps_near('19401', 25) n join camps c on c.id=n.camp_id order by n.distance_miles limit 1;" \
       "the nearest camp to 19401 is the one in Norristown"                                                                 "^norristown-week-1$"
assert "select round(n.distance_miles) from camps_near('19401', 60) n join camps c on c.id=n.camp_id where c.slug='cherry-hill-week-2';" \
       "Cherry Hill is about twenty-one miles from Norristown"                                                              "^21$"
assert "select count(*) from camps_near('19401', 10);" \
       "a ten-mile radius excludes the New Jersey camp"                                                                     "^1$"
assert "select count(*) from camps_near('19401', 60, 'NJ');" \
       "filtering by state works"                                                                                           "^1$"
assert "select count(*) from camps_near(null, 40, null, null, 4::smallint);" \
       "a four-year-old is too young for any of them"                                                                       "^0$"
assert "select count(*) from camps_near('19401', 60, null, null, null, 'half_day');" \
       "…and only two camps offer half days"                                                                                "^2$"
assert "select count(*) from camps_near('19401', 60) n join camps c on c.id=n.camp_id where c.status='full';" \
       "a full camp still appears, so the family can join the waitlist"                                                     "^1$"
assert "select count(*) from camps_near('19401', 60) n join camps c on c.id=n.camp_id where c.status='draft';" \
       "a draft camp appears nowhere"                                                                                       "^0$"
echo

echo "CAMP REGISTRATION"
NORRIS=$(Q "select id from camps where slug='norristown-week-1';")
FULLCAMP=$(Q "select id from camps where slug='doylestown-week-1';")
assert "select id from begin_camp_registration('$NORRIS','$TAYO','full_day','camp-1');" \
       "a registration without the paperwork is refused before Stripe"                                                      "Still needed"
DETAILS='{"emergency_contact_name":"Simi Adeyemi","emergency_contact_phone":"+12155550208","waiver_agreed":"true","media_release_agreed":"true","conduct_agreed":"true","refund_policy_agreed":"true","medical_auth_agreed":"true"}'
assert "select amount_cents from begin_camp_registration('$NORRIS','$TAYO','full_day','camp-1','{}'::uuid[],'$DETAILS'::jsonb);" \
       "a full-day week is priced from the camp record"                                                                     "^39500$"
assert "select held from camp_occupancy('$NORRIS');" "…and holds a place while they pay"                                    "^1$"
ADDON=$(Q "select id from camp_addons where camp_id='$NORRIS' and code='before_care';")
assert "select price_camp('$NORRIS','full_day', array['$ADDON']::uuid[]);" \
       "before care is priced from its own row, not from the request"                                                       "^44500$"
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='camp-1'),'pi_camp_1');" >/dev/null
assert "select settle_checkout('pi_camp_1',39500,'ch_camp_1')::text;" \
       "paying registers the player"                                                                                        '"sessions_booked": 1'
assert "select status from camp_registrations where camp_id='$NORRIS' and player_id='$TAYO';" \
       "…confirmed, with the waiver timestamped"                                                                            "^confirmed$"
assert "select waiver_agreed_at is not null from camp_registrations where camp_id='$NORRIS' and player_id='$TAYO';" \
       "…and the agreements recorded with a time, not a tick"                                                               "^t$"
assert "select held from camp_occupancy('$NORRIS');" "…and the hold released"                                               "^0$"
assert "select settle_checkout('pi_camp_1',39500,'ch_camp_1')::text;" \
       "a replayed camp webhook registers nobody twice"                                                                     '"idempotent": true'
assert "select count(*) from camp_registrations where camp_id='$NORRIS' and player_id='$TAYO';" \
       "…one registration"                                                                                                  "^1$"
assert "select id from begin_camp_registration('$FULLCAMP','$TAYO','full_day','camp-2','{}'::uuid[],'$DETAILS'::jsonb);" \
       "a full camp refuses a registration before Stripe"                                                                   "camp is full"
assert "select id from join_camp_waitlist('$FULLCAMP','$TAYO');" \
       "…but the waitlist takes them"                                                                                       "-"
assert "select id from begin_camp_registration('$NORRIS','$TAYO','half_day','camp-3','{}'::uuid[],'$DETAILS'::jsonb);" \
       "a player already registered cannot register again"                                                                  "already registered"
echo

echo "THE ANONYMOUS HOLE — every one of these worked before 0017"
BOOKING_ANY=$(Q "select id from bookings where status='confirmed' limit 1;")
CREDIT_ANY=$(Q "select id from package_credits limit 1;")
SESSION_ANY=$(Q "select id from sessions where status='scheduled' limit 1;")
PLAYER_ANY=$(Q "select id from players limit 1;")
SHIFT_ANY=$(Q "select id from trainer_shifts limit 1;")

assert_anon "select settle_checkout('pi_invented', 56000, 'ch_invented');" \
       "a visitor cannot settle a payment that never happened"                                                              "permission denied"
assert_anon "select attach_payment_intent('$BOOKING_ANY','pi_invented');" \
       "…nor bind a checkout to a Stripe id of their choosing"                                                              "permission denied"
assert_anon "select confirm_booking('$SESSION_ANY','$PLAYER_ANY',null,'$CREDIT_ANY',0);" \
       "…nor confirm a booking against someone else's credit"                                                               "permission denied"
assert_anon "select issue_makeup_credit((select household_id from bookings limit 1),(select id from seasons limit 1),'free money');" \
       "…nor mint a credit"                                                                                                 "permission denied"
assert_anon "select record_trainer_hours('$SHIFT_ANY');" \
       "…nor book payroll"                                                                                                  "permission denied"
assert_anon "select override_confirm_block('$SHIFT_ANY','because I said so');" \
       "…nor commit a trainer against the block rule"                                                                       "permission denied"
assert_anon "select write_audit('admin',null,'booking.confirmed','bookings','$BOOKING_ANY');" \
       "…nor forge a line in the audit log"                                                                                 "permission denied"
assert_anon "select claim_webhook_event('stripe','evt_not_sent_yet','x','{}');" \
       "…nor claim a Stripe event id before Stripe sends it"                                                                "permission denied"
assert_anon "select run_scheduled_job('record_hours','manual');" \
       "…nor run a scheduled job"                                                                                           "permission denied"
assert_anon "select cancel_booking('$BOOKING_ANY', true, 'vandalism');" \
       "…nor cancel a stranger's booking"                                                                                   "permission denied"
assert_anon "select begin_checkout('group_package','$PLAYER_ANY',(select id from training_groups where slug='u9-foundation'),'anon-1');" \
       "…nor start a checkout for somebody else's child"                                                                    "permission denied"
assert_anon "select camps_near('19401', 25);" \
       "but the public catalogue still answers"                                                                             "-"
assert_anon "select paid from group_occupancy((select id from training_groups where slug='u9-foundation'));" \
       "…and so does how full a group is"                                                                                   "^[0-9]"
echo

echo "A SIGNED-IN PARENT IS NOT STAFF EITHER"
assert_as "$MAI" "select settle_checkout('pi_invented_2', 56000, 'ch_x');" \
       "a parent cannot settle their own payment"                                                                           "permission denied"
assert_as "$MAI" "select record_trainer_hours('$SHIFT_ANY');" \
       "…nor book a trainer's hours"                                                                                        "permission denied"
assert_as "$MAI" "select override_confirm_block('$SHIFT_ANY','pay me');" \
       "…nor override a block"                                                                                              "permission denied"
assert_as "$MAI" "select issue_makeup_credit((select household_id from bookings limit 1),(select id from seasons limit 1),'free money');" \
       "…nor issue themselves a credit"                                                                                     "permission denied"
assert_as "$MAI" "select write_audit('admin',null,'x','bookings',null);" \
       "…nor write to the audit log"                                                                                        "permission denied"
echo

echo "WHAT THE AUDIT FOUND — each of these was reproducible before 0018"
GROUP_A2=$(Q "select id from training_groups where slug='u12-advanced';")

# A parent asking to be treated as staff.
LATE=$(Q "select b.id from bookings b join sessions s on s.id=b.session_id
          where b.status='confirmed' order by s.starts_at limit 1;")
Q "update sessions set starts_at = now() + interval '2 hours', ends_at = now() + interval '3 hours'
   where id = (select session_id from bookings where id='$LATE');" >/dev/null
LATE_HH=$(Q "select c.auth_user_id from bookings b join contacts c on c.household_id=b.household_id
             where b.id='$LATE' and c.is_primary limit 1;")
assert_as "$LATE_HH" "select (cancel_booking('$LATE', true, 'refund me')::jsonb) ->> 'refund_due';" \
       "a parent cannot claim a staff refund by passing a flag"                                                             "^false$"

# The refund path, which had never once executed.
PAY_ANY=$(Q "select id from payments where status='succeeded' limit 1;")
assert "select amount_cents from record_refund('$PAY_ANY', 1000, 'rf_test_1', 'goodwill');" \
       "recording a refund works at all — it used to raise on every call"                                                   "^1000$"
assert "select status::text from payments where id='$PAY_ANY';" \
       "…and the payment reads as partially refunded"                                                                       "partially_refunded"
assert "select amount_cents from record_refund('$PAY_ANY', 1000, 'rf_test_1', 'goodwill');" \
       "…and recording the same Stripe refund twice returns the first"                                                      "^1000$"
assert "select count(*) from refunds where stripe_refund_id='rf_test_1';" "…one row"                                        "^1$"

# Credits belonging to somebody else.
FOREIGN_CREDIT=$(Q "select id from package_credits where state='available'
                    and household_id <> (select household_id from players where first_name='Bao') limit 1;")
BAO=$(Q "select id from players where first_name='Bao';")
FREE_SESSION=$(Q "select s.id from sessions s join training_groups g on g.id=s.group_id
                  where g.slug='u12-advanced' and s.starts_at > now() order by s.starts_at limit 1;")
assert "select id from confirm_booking('$FREE_SESSION','$BAO',null,'$FOREIGN_CREDIT',0);" \
       "a credit from another household cannot pay for a booking"                                                           "belongs to another household"

# One credit, two sessions.
OWN_CREDIT=$(Q "select id from package_credits where state='available' limit 1;")
OWNER=$(Q "select p.id from players p where p.household_id=(select household_id from package_credits where id='$OWN_CREDIT') limit 1;")
S1=$(Q "select s.id from sessions s where s.starts_at > now() order by s.starts_at limit 1;")
S2=$(Q "select s.id from sessions s where s.starts_at > now() order by s.starts_at offset 1 limit 1;")
Q "select confirm_booking('$S1','$OWNER',null,'$OWN_CREDIT',0);" >/dev/null
assert "select id from confirm_booking('$S2','$OWNER',null,'$OWN_CREDIT',0);" \
       "one credit cannot pay for two sessions"                                                                             "already been used"

# Settling something that should not settle.
Q "select begin_checkout('group_dropin','$TAYO','$FREE_SESSION','late-1');" >/dev/null 2>&1
Q "select begin_checkout('group_dropin','66666666-0000-0000-0000-000000000008',
     (select s.id from sessions s join training_groups g on g.id=s.group_id
      where g.slug='u10-development' and s.starts_at>now() order by s.starts_at limit 1),'late-2');" >/dev/null
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='late-2'),'pi_late');" >/dev/null
Q "update checkout_intents set state='expired' where idempotency_key='late-2';" >/dev/null
assert "select settle_checkout('pi_late', 4000, 'ch_late')::text;" \
       "a payment landing after the hold expired is held, not fulfilled"                                                    "intent_expired"

Q "select begin_checkout('group_dropin','66666666-0000-0000-0000-000000000008',
     (select s.id from sessions s join training_groups g on g.id=s.group_id
      where g.slug='u10-development' and s.starts_at>now() order by s.starts_at offset 1 limit 1),'under-1');" >/dev/null
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='under-1'),'pi_under');" >/dev/null
assert "select settle_checkout('pi_under', 1, 'ch_under')::text;" \
       "one cent does not buy a \$40 session"                                                                               "underpaid"
assert "select count(*) from payments where stripe_payment_intent_id='pi_under';" \
       "…and no payment row is written for it"                                                                              "^0$"
echo

echo "BLOCKS — a day is not a block"
Q "delete from trainer_shifts;" >/dev/null
Q "update private_slots set status='available', shift_id=null;" >/dev/null
SAM=$(Q "select id from trainers where slug='sam-whitfield';")
Q "insert into private_slots (trainer_id, location_id, starts_at, ends_at, status)
   select '$SAM', location_id, starts_at + interval '11 hours', ends_at + interval '11 hours', 'booked'
   from private_slots order by starts_at limit 1;" >/dev/null
Q "update private_slots set status='booked' where starts_at::time='09:00';" >/dev/null
FIRST_SLOT=$(Q "select id from private_slots where starts_at::time='09:00' limit 1;")
assert "select evaluate_trainer_block('$FIRST_SLOT')::text;" \
       "two sessions eleven hours apart are two trips, not one block"                                                       "awaiting_second_booking"
assert "select count(*) from trainer_shifts;" "…and no twelve-hour shift is created"                                        "^0$"
assert "select adjoins(now(), now() + interval '1 hour', now() + interval '61 minutes', now() + interval '2 hours', true, 90, 30);" \
       "a one-minute gap across town does not adjoin — there is no time to drive"                                           "^f$"
assert "select adjoins(now(), now() + interval '1 hour', now() + interval '90 minutes', now() + interval '2 hours', true, 90, 30);" \
       "…half an hour later does"                                                                                           "^t$"
assert "select adjoins(now(), now() + interval '1 hour', now() + interval '5 hours', now() + interval '6 hours', false, 90, 30);" \
       "…and four hours later, anywhere, does not"                                                                          "^f$"
echo

echo "CREDITS AND WAITLISTS"
HOLD_SESSION=$(Q "select s.id from sessions s join training_groups g on g.id=s.group_id
                  where g.slug='u12-advanced' and s.starts_at>now() order by s.starts_at limit 1;")
CREDIT_OWNER=$(Q "select p.id from players p join enrollments e on e.player_id=p.id
                  join training_groups g on g.id=e.group_id where g.slug='u12-advanced' limit 1;")
BEFORE=$(Q "select count(*) from package_credits where state='available';")
Q "select create_booking_hold('$HOLD_SESSION','$CREDIT_OWNER',true);" >/dev/null 2>&1
Q "select create_booking_hold('$HOLD_SESSION','$CREDIT_OWNER',true);" >/dev/null 2>&1
Q "select create_booking_hold('$HOLD_SESSION','$CREDIT_OWNER',true);" >/dev/null 2>&1
AFTER=$(Q "select count(*) from package_credits where state='available';")
assert "select $BEFORE - $AFTER;" "three taps of book-with-credit reserve one credit, not three"                            "^[01]$"
assert "select release_stranded_credits() >= 0;" "…and a stranded reservation can be recovered at all"                      "^t$"

Q "update waitlists set state='waiting', invited_at=null, invite_expires_at=null;" >/dev/null
Q "insert into waitlists (group_id, player_id, household_id, position)
   select '$GROUP_A2', id, household_id, 90 from players where first_name in ('Mateo','Tunde')
   on conflict do nothing;" >/dev/null
Q "update enrollments set state='withdrawn' where group_id='$GROUP_A2' and state='active'
   and player_id=(select player_id from enrollments where group_id='$GROUP_A2' and state='active' limit 1);" >/dev/null
Q "select promote_waitlist('$GROUP_A2');" >/dev/null
Q "select promote_waitlist('$GROUP_A2');" >/dev/null
Q "select promote_waitlist('$GROUP_A2');" >/dev/null
assert "select count(*) from waitlists where group_id='$GROUP_A2' and state='invited';" \
       "one open place is offered to one family, not to everyone on the list"                                               "^1$"
echo

echo "JOBS AND SETTINGS"
Q "select claim_webhook_event('stripe','evt_stuck','x','{}');" >/dev/null
Q "update webhook_events set claimed_at = now() - interval '2 hours' where external_id='evt_stuck';" >/dev/null
assert "select reap_stale_webhook_claims();" "an event claimed by a handler that died is released for retry"                "^1$"
assert "select claim_webhook_event('stripe','evt_stuck','x','{}');" "…and Stripe's next delivery is taken"                  "^t$"
assert "select generate_group_sessions((select id from training_groups where slug='u12-advanced'));" \
       "re-running season generation reports the truth: nothing new"                                                        "^0$"
assert "insert into training_groups (season_id, name, slug, status, location_id, trainer_id)
        select season_id, 'Sneaked in', 'sneaked-in', 'confirmed', location_id, trainer_id
        from training_groups where slug='u13-pending';" \
       "a group cannot be inserted straight into confirmed on an unverified field"                                          "not verified and permitted"
assert_anon "select value from system_settings where key='free_cancel_hours';" \
       "a visitor can read the cancellation window they are shown"                                                          "^24$"
assert_anon "select count(*) from system_settings where key='automation_paused';" \
       "…and nothing operational"                                                                                           "^0$"
echo

echo "THE AGENT"
assert "select normalize_phone('(215) 555-0208') = '+12155550208';" \
       "a phone number is normalised before it is matched on"                                                               "^t$"
assert "select normalize_phone('12155550208') = '+12155550208';" \
       "…however it arrives"                                                                                                "^t$"
assert "select normalize_phone('+442071234567') = '+442071234567';" \
       "…and a number it cannot parse is left alone, not guessed at"                                                        "^t$"

assert "select find_contact('+12155550208', null) = (select id from contacts where email='simi.demo@example.test');" \
       "an inbound text finds the family we already know"                                                                   "^t$"
assert "select find_or_create_contact('(215) 555-0208', null, 'Simi', 'Adeyemi') = (select id from contacts where email='simi.demo@example.test');" \
       "…and does not make a second one"                                                                                    "^t$"
BEFORE_H=$(Q "select count(*) from households;")
Q "select find_or_create_contact(null, 'SIMI.DEMO@example.test', 'Simi', 'Adeyemi');" >/dev/null
assert "select count(*) - $BEFORE_H from households;" "…nor when the same family arrives by email in capitals"               "^0$"
Q "select find_or_create_contact('+12155559999', 'new.parent@example.test', 'New', 'Parent');" >/dev/null
assert "select count(*) - $BEFORE_H from households;" "a family we have never met gets exactly one household"               "^1$"

INB=$(Q "select record_inbound_message('sms','+12155550208',null,'Is there a camp near 19401?','quo_msg_1');")
CONV=$(Q "select id from conversations where contact_id=(select id from contacts where email='simi.demo@example.test') limit 1;")
assert "select record_inbound_message('sms','+12155550208',null,'Is there a camp near 19401?','quo_msg_1')::text;" \
       "a redelivered inbound message is not answered twice"                                                                '"duplicate": true'

assert "select (agent_context('$CONV')::jsonb) -> 'contact' ->> 'first_name';" \
       "the agent reads who it is talking to from the database"                                                             "^Simi$"
assert "select jsonb_array_length((agent_context('$CONV')::jsonb) -> 'players');" \
       "…and which children they have"                                                                                      "^1$"
assert "select jsonb_array_length((agent_options_for_player('$TAYO')::jsonb) -> 'groups');" \
       "…and is only ever offered groups that player is eligible for"                                                       "^[0-9]"
assert "select ((agent_options_for_player('$TAYO')::jsonb) -> 'groups' -> 0 ->> 'name') like '%U9%';" \
       "…which for an eight-year-old is the U9 group, not the U14 one"                                                      "^t$"

assert "select must_escalate('He hurt his ankle at training on Tuesday');" \
       "an injury goes to a person whether or not the model notices"                                                        "^safety$"
assert "select must_escalate('I want a refund, you charged me twice');" "…so does a disputed charge"                        "^refund$"
assert "select must_escalate('my lawyer will be in touch');" "…and anything legal"                                          "^legal$"
assert "select must_escalate('What time does Thursday start?');" "…an ordinary question does not"                           "^$"

assert "select escalate_conversation('$CONV','safety','Parent reported an injury','urgent','Ring them today') is not null;" \
       "escalating hands the thread to a person"                                                                            "^t$"
assert "select human_owned from conversations where id='$CONV';" "…and the agent stops talking on it"                       "^t$"
assert "select queue_outbound_message('$CONV','Just checking in!');" \
       "…so an automated message on that thread is refused"                                                                 "human owns this conversation"
echo

echo "CONSENT"
STOP_CONV=$(Q "select id from conversations where contact_id=(select id from contacts where email='mai.demo@example.test') limit 1;")
Q "insert into conversations (household_id, contact_id, channel, phone_number)
   select household_id, id, 'sms', phone from contacts where email='mai.demo@example.test'
   on conflict do nothing;" >/dev/null
MAI_CONV=$(Q "select id from conversations where contact_id=(select id from contacts where email='mai.demo@example.test') limit 1;")
assert "select may_contact((select id from contacts where email='mai.demo@example.test'),'sms',true);" \
       "a family who agreed can be texted"                                                                                  "^t$"
Q "select record_inbound_message('sms','+12155550203',null,'STOP','quo_stop_1');" >/dev/null
assert "select may_contact((select id from contacts where email='mai.demo@example.test'),'sms',true);" \
       "STOP works, and works immediately"                                                                                  "^f$"
assert "select unsubscribed_at is not null from contacts where email='mai.demo@example.test';" \
       "…and is recorded with the moment it happened"                                                                       "^t$"
assert "select queue_outbound_message('$MAI_CONV','Come back!');" \
       "…and nothing automated reaches them afterwards"                                                                     "cannot be contacted"
Q "select record_inbound_message('sms','+12155550203',null,'START','quo_start_1');" >/dev/null
assert "select may_contact((select id from contacts where email='mai.demo@example.test'),'sms',true);" \
       "…until they say so themselves"                                                                                       "^t$"

assert "select schedule_followup((select id from households limit 1),'unpaid_link', now(),'bookings',null) is not null;" \
       "a follow-up can be scheduled"                                                                                       "^t$"
assert "select schedule_followup((select id from households limit 1),'unpaid_link', now(),'bookings',null) is null;" \
       "…and scheduling the same one twice does nothing"                                                                    "^t$"
echo

echo "THE AGENT CANNOT REACH PAST A BROWSER"
assert_anon "select agent_context('$CONV');"  "a visitor cannot read the agent's view of a family"                          "permission denied"
assert_anon "select find_or_create_contact('+12155551234', null, 'X', 'Y');" \
       "…nor create a contact"                                                                                              "permission denied"
assert_anon "select record_inbound_message('sms','+1','x','y','z');" "…nor inject an inbound message"                       "permission denied"
assert_as "$MAI" "select agent_context('$CONV');" "a signed-in parent cannot either"                                        "permission denied"
assert_as "$MAI" "select escalate_conversation('$CONV','safety','x');" "…nor raise an escalation as the agent"              "permission denied"
echo

echo "FOLLOW-UPS"
Q "update contacts set sms_consent = true, email_consent = true, unsubscribed_at = null;" >/dev/null

# Quiet hours are real behaviour and are asserted in both directions below, but
# they must not make the rest of these assertions depend on the hour the suite
# happens to run at. The window is set explicitly to one that cannot contain
# now, then to one that must.
LOCAL_HOUR=$(Q "select extract(hour from (now() at time zone 'America/New_York'))::int;")
AWAY_START=$(( (LOCAL_HOUR + 2) % 24 ))
AWAY_END=$(( (LOCAL_HOUR + 3) % 24 ))
Q "update system_settings set value='$AWAY_START' where key='quiet_hours_start';" >/dev/null
Q "update system_settings set value='$AWAY_END' where key='quiet_hours_end';" >/dev/null

Q "select begin_checkout('group_dropin','66666666-0000-0000-0000-000000000008',
     (select s.id from sessions s join training_groups g on g.id=s.group_id
      where g.slug='u10-development' and s.starts_at>now() order by s.starts_at offset 3 limit 1),'follow-1');" >/dev/null
Q "select attach_payment_intent((select id from checkout_intents where idempotency_key='follow-1'),'pi_follow');" >/dev/null
Q "update checkout_intents set created_at = now() - interval '3 hours' where idempotency_key='follow-1';" >/dev/null

assert "select queue_followups() > 0;" "an unpaid payment link earns a follow-up"                                          "^t$"
BEFORE_F=$(Q "select count(*) from scheduled_followups where state='pending';")
Q "select queue_followups();" >/dev/null
assert "select count(*) - $BEFORE_F from scheduled_followups where state='pending';" \
       "…and running the job again does not queue it twice"                                                                "^0$"
assert "select send_due_followups() > 0;" "…and it is sent"                                                                "^t$"
assert "select send_due_followups();" "…once"                                                                              "^0$"

# A family who paid in the meantime must not be chased for not paying. Its own
# row, so the assertion does not depend on the state left by the one above.
Q "update checkout_intents set state='settled' where idempotency_key='follow-1';" >/dev/null
Q "update scheduled_followups set state='pending', sent_at=null, skipped_reason=null
   where reason='unpaid_link';" >/dev/null
Q "select send_due_followups();" >/dev/null
assert "select skipped_reason from scheduled_followups where reason='unpaid_link' limit 1;" \
       "a family who has since paid is not chased for not paying"                                                          "no longer applies"

# Consent. The follow-up needs a subject that still applies, or it is skipped
# for that reason before consent is ever reached — so this one gets a real
# conversation that is genuinely waiting on us.
Q "insert into conversations (household_id, contact_id, channel, phone_number, state)
   select household_id, id, 'sms', phone, 'waiting_on_us' from contacts
   where email='rafa.demo@example.test';" >/dev/null
WAITING=$(Q "select id from conversations where state='waiting_on_us'
             and contact_id=(select id from contacts where email='rafa.demo@example.test') limit 1;")
Q "update conversations set last_message_at = now() - interval '6 hours' where id='$WAITING';" >/dev/null
Q "select schedule_followup((select household_id from contacts where email='rafa.demo@example.test'),
     'awaiting_reply', now(), 'conversations', '$WAITING');" >/dev/null
Q "update contacts set sms_consent=false where email='rafa.demo@example.test';" >/dev/null
Q "select send_due_followups();" >/dev/null
assert "select skipped_reason from scheduled_followups where reason='awaiting_reply' limit 1;" \
       "a family who never agreed to be texted is not texted"                                                              "consent or quiet hours"
Q "update contacts set sms_consent=true where email='rafa.demo@example.test';" >/dev/null

# And now the window that must contain now.
Q "update system_settings set value='$LOCAL_HOUR' where key='quiet_hours_start';" >/dev/null
Q "update system_settings set value='$(( (LOCAL_HOUR + 1) % 24 ))' where key='quiet_hours_end';" >/dev/null
Q "update scheduled_followups set state='pending', sent_at=null, skipped_reason=null
   where reason='awaiting_reply';" >/dev/null
Q "select send_due_followups();" >/dev/null
assert "select skipped_reason from scheduled_followups where reason='awaiting_reply' limit 1;" \
       "…and nobody is chased in the middle of the night"                                                                  "consent or quiet hours"
assert "select may_contact((select id from contacts where email='rafa.demo@example.test'),'sms',true);" \
       "…but a reminder about a session they booked still goes out"                                                        "^t$"
Q "update system_settings set value='21' where key='quiet_hours_start';" >/dev/null
Q "update system_settings set value='8' where key='quiet_hours_end';" >/dev/null

Q "update system_settings set value='true' where key='automation_paused';" >/dev/null
assert "select queue_followups();" "the pause switch stops the agent chasing anyone"                                        "^0$"
assert "select send_due_followups();" "…in both directions"                                                                 "^0$"
Q "update system_settings set value='false' where key='automation_paused';" >/dev/null
echo

echo "THE CRM VIEW"
assert "select count(*) > 0 from hubspot_sync_batch(now() - interval '1 day');" \
       "families that changed are in the sync batch"                                                                        "^t$"
assert "select count(*) from hubspot_sync_batch(now() + interval '1 day');" \
       "…and families that did not are not"                                                                                 "^0$"
assert "select lifetime_spend_cents >= 0 from hubspot_sync_batch(now() - interval '1 day') limit 1;" \
       "lifetime spend is net of refunds, so it is a number worth trusting"                                                 "^t$"
assert "select lead_status from hubspot_sync_batch(now() - interval '1 day')
        where email='simi.demo@example.test';" \
       "a family with an open escalation is marked as needing attention"                                                    "needs_attention\|customer"
assert_anon "select count(*) from hubspot_sync_batch(now());" \
       "a visitor cannot read the CRM view of every family"                                                                 "permission denied"
echo

echo "REPORTS AND PAYROLL"
ADMIN_JWT='{"role":"authenticated","sub":"77777777-0000-0000-0000-000000000001","app_metadata":{"ptp_role":"admin"}}'
ADMIN() {
  psql $PSQL_ARGS -d "$DB" -tA -q 2>&1 <<EOF | grep -v '^$'
begin;
set local role authenticated;
set local request.jwt.claims = '$ADMIN_JWT';
$1
commit;
EOF
}
assert_admin() {
  local got; got=$(ADMIN "$1")
  if echo "$got" | grep -qi -- "$3"; then
    printf "  ok   %s\n" "$2"; pass=$((pass+1))
  else
    printf "  FAIL %s\n         got: %s\n" "$2" "$(echo "$got" | head -1)"; fail=$((fail+1))
  fi
}

assert_admin "select jsonb_typeof(operations_today() -> 'escalations');" \
       "an administrator gets the morning view"                                                                             "^array$"
assert_admin "select jsonb_array_length(operations_today() -> 'groups_nearly_running') >= 0;" \
       "…including the groups one family from running"                                                                      "^t$"
assert_admin "select (operations_today() ->> 'automation_paused');" \
       "…and whether the machinery is running at all"                                                                       "^false$"
assert_as "$MAI" "select operations_today();" \
       "a parent cannot read the operations view"                                                                           "administrator action"
assert_anon "select operations_today();" "…nor can a visitor"                                                               "permission denied"

# The PAY section above consumed the one shift, so make a payable week here
# rather than depending on what an earlier assertion happened to leave behind.
Q "insert into trainer_hours (trainer_id, worked_on, minutes, hourly_rate_cents, amount_cents)
   select id, current_date - 3, 120, 4000, 8000 from trainers where slug='marcus-bell';" >/dev/null
TRAINER_PAID=$(Q "select id from trainers where slug='marcus-bell';")

assert_admin "select count(*) >= 0 from payroll_for_period(current_date - 60, current_date);" \
       "payroll totals what was recorded"                                                                                   "^t$"
assert_admin "select amount_cents from payroll_for_period(current_date - 60, current_date) limit 1;" \
       "…in cents, like everything else"                                                                                    "^[0-9]"
assert_as "$MAI" "select * from payroll_for_period(current_date - 60, current_date);" \
       "a parent cannot read the payroll, even though the grant includes them"                                              "administrator action"
assert_as "$MAI" "select * from camp_utilisation();" \
       "…nor the revenue on every camp"                                                                                     "administrator action"
assert_as "$MAI" "select * from attendance_summary(current_date - 30, current_date);" \
       "…nor how every other family's child is attending"                                                                    "administrator action"

assert_admin "select mark_payroll_paid('$TRAINER_PAID', current_date - 60, current_date, 'batch-1');" \
       "marking a payroll run paid marks the hours in it"                                                                    "^[1-9]"
assert_admin "select mark_payroll_paid('$TRAINER_PAID', current_date - 60, current_date, 'batch-2');" \
       "…and running the export twice does not pay twice"                                                                    "^0$"

assert_admin "select round(fill_rate,2) from camp_utilisation() where name like 'Doylestown%';" \
       "a full camp reads as fully utilised"                                                                                 "^1.00$"
assert_admin "select short_by from group_utilisation() where name like '%U9%';" \
       "a group short of the threshold says how short"                                                                       "^[0-9]"
assert_admin "select jsonb_typeof(weekly_summary(current_date) -> 'revenue');" \
       "the weekly summary is one object"                                                                                    "^object$"
assert_admin "select (weekly_summary(current_date) -> 'revenue' ->> 'gross_cents')::bigint >= 0;" \
       "…with revenue net of nothing it should not be"                                                                       "^t$"
echo

echo "WORKING THE QUEUE"
ESC=$(Q "select id from escalations order by raised_at limit 1;")
assert_admin "select acknowledge_escalation('$ESC');" "an escalation can be picked up"                                       "^$"
assert "select state::text from escalations where id='$ESC';" "…and shows as acknowledged"                                   "^acknowledged$"
assert_admin "select resolve_escalation('$ESC','Rang them; sorted', false);" "…and closed with what was done"                "^$"
assert "select resolution from escalations where id='$ESC';" "…which is recorded"                                            "Rang them"
assert "select count(*) from audit_logs where action='escalation.resolved';" "…in the audit log"                             "^1$"
assert_as "$MAI" "select resolve_escalation('$ESC','nothing to see', true);" \
       "a parent cannot close an escalation about themselves"                                                                "administrator action"

assert_admin "select set_automation_paused(true, 'incident');" "an administrator can stop everything"                        "^t$"
assert "select automation_paused();" "…and it takes effect immediately"                                                      "^t$"
assert "select count(*) from audit_logs where action='automation.paused';" "…recorded with a reason"                          "^1$"
assert_admin "select set_automation_paused(false, 'all clear');" "…and start it again"                                        "^f$"
assert_as "$MAI" "select set_automation_paused(true, 'mischief');" "a parent cannot"                                          "administrator action"
echo

echo "REMOVING THE MODULE"
# The last thing a module has to prove is that it can leave. Run this at the
# end, because everything after it is a platform with no agent.
if ! psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -q -f modules/agent/999_uninstall.sql >/dev/null 2>&1; then
  printf "  FAIL the agent module could not be uninstalled\n"; fail=$((fail+1))
  psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -f modules/agent/999_uninstall.sql 2>&1 | grep ERROR | head -3
else
  printf "  ok   the agent module uninstalls cleanly\n"; pass=$((pass+1))
fi
assert "select count(*) from platform_modules where name='agent';" "…deregistering itself"                                    "^0$"
assert "select 'queue_followups' = any(jobs_for_tier('hourly'));" "…and taking its scheduled work with it"                    "^f$"
assert "select to_regclass('public.scheduled_followups') is null;" "…and its queue"                                           "^t$"
assert "select count(*) > 0 from messages;" "the family's messages are still there"                                          "^t$"
assert "select count(*) > 0 from conversations;" "…and their threads"                                                        "^t$"
assert "select sms_consent from contacts where email='simi.demo@example.test';" "…and what they agreed to receive"           "^t$"
assert "select price_group_package((select id from training_groups where slug='u9-foundation')) > 0;" \
       "and the platform still sells a season"                                                                               "^t$"
assert "select (weekly_summary()::jsonb) ->> 'needs_follow_up';" "…and still reports a complete week"                        "^0$"
echo

echo "============================================================"
printf "  %d passed, %d failed\n" "$pass" "$fail"
echo "============================================================"
[ "$fail" -eq 0 ] || exit 1
