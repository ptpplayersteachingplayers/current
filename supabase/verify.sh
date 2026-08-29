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
Q() { psql $PSQL_ARGS -d "$DB" -tA -q -c "$1" 2>&1; }

# Run as a signed-in parent or trainer. SET LOCAL only takes effect inside a
# transaction, and a bare -c gives each statement its own — which silently left
# every authorisation check running as the database owner the first time.
AS() { # AS <auth.uid> <sql>
  psql $PSQL_ARGS -d "$DB" -tA -q 2>&1 <<EOF | grep -v '^$'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
$2
commit;
EOF
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
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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

echo "============================================================"
printf "  %d passed, %d failed\n" "$pass" "$fail"
echo "============================================================"
[ "$fail" -eq 0 ] || exit 1
