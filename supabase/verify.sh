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

pass=0; fail=0
assert() { # assert <sql> <description> <expected-substring>
  local got; got=$(Q "$1")
  if echo "$got" | grep -qi -- "$3"; then
    printf "  ok   %s\n" "$2"; pass=$((pass+1))
  else
    printf "  FAIL %s\n         got: %s\n" "$2" "$(echo "$got" | head -1)"; fail=$((fail+1))
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

echo "============================================================"
printf "  %d passed, %d failed\n" "$pass" "$fail"
echo "============================================================"
[ "$fail" -eq 0 ] || exit 1
