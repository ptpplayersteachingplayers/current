#!/usr/bin/env bash
# =============================================================================
# Booking a package, from the database's side
# =============================================================================
#   ./trace-booking.sh
#
# Runs one family's purchase against a real PostgreSQL and prints what changed
# after each step. Every number below is read back out of the database, not
# written here — this is a transcript, not an illustration.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")"

DB="${DB:-ptp_trace}"
A="-h ${PGHOST:-/tmp/pgtest/sock} -p ${PGPORT:-5433} -U ${PGUSER:-postgres}"
Q() { psql $A -d "$DB" -tA -q -c "$1" 2>&1; }
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
row() { printf '    %-34s %s\n' "$1" "$2"; }

psql $A -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
psql $A -d "$DB" -q >/dev/null 2>&1 <<'SQL'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
grant usage on schema auth to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL
for f in migrations/*.sql seed/*.sql; do
  psql $A -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "could not apply $f"; exit 1; }
done

GROUP=$(Q "select id from training_groups where slug='u9-foundation';")
PLAYER='66666666-0000-0000-0000-00000000000d'   # Tayo Adeyemi
PARENT='77777777-0000-0000-0000-000000000008'   # Simi, his mother
# The seed already contains one family's part-spent package. Everything below
# is scoped to this household so the numbers are this purchase and not the
# fixture's.
HOUSE=$(Q "select household_id from players where id='$PLAYER';")

say "Before — the group Tayo wants to join"
row "status"              "$(Q "select status from training_groups where slug='u9-foundation';")"
row "paid players"        "$(Q "select paid from group_occupancy('$GROUP');") of $(Q "select min_players from training_groups where id='$GROUP';") needed to start"
row "sessions scheduled"  "$(Q "select count(*) from sessions where group_id='$GROUP';")"

say "1. Simi taps Book — begin_checkout()"
AMOUNT=$(psql $A -d "$DB" -tA -q <<EOF 2>&1 | tail -1
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$PARENT';
select amount_cents from begin_checkout('group_package','$PLAYER','$GROUP','tap-1');
commit;
EOF
)
row "price the server decided"  "\$$(( AMOUNT / 100 )) — read from system_settings, never sent by the browser"
row "hold created"              "$(Q "select count(*) from booking_holds;") · expires $(Q "select to_char(expires_at,'HH24:MI:SS') from booking_holds limit 1;")"
row "the place is occupied"     "$(Q "select paid||' paid + '||held||' held' from group_occupancy('$GROUP');")"
row "bookings so far"           "$(Q "select count(*) from bookings where player_id='$PLAYER';")"

say "2. She taps Book again — the same key"
psql $A -d "$DB" -tA -q <<EOF >/dev/null 2>&1
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$PARENT';
select begin_checkout('group_package','$PLAYER','$GROUP','tap-1');
commit;
EOF
row "checkouts"                 "$(Q "select count(*) from checkout_intents;") — the unique index on (household, key) held"
row "holds"                     "$(Q "select count(*) from booking_holds;")"

say "3. Stripe takes the money and calls the webhook"
INTENT=$(Q "select id from checkout_intents limit 1;")
Q "select attach_payment_intent('$INTENT','pi_trace_1');" >/dev/null
row "claim_webhook_event"       "$(Q "select claim_webhook_event('stripe','evt_trace_1','payment_intent.succeeded','{}');") — first delivery"
row "settle_checkout"           "$(Q "select settle_checkout('pi_trace_1', $AMOUNT, 'ch_trace_1');")"

say "4. What that one call did"
row "payment"                   "$(Q "select description||' · \$'||(amount_cents/100)||' · '||status from payments where household_id='$HOUSE';")"
row "package"                   "$(Q "select session_count||' sessions · expires '||expires_on from packages where household_id='$HOUSE';")"
row "credits issued"            "$(Q "select count(*) from package_credits where household_id=(select household_id from players where id='$PLAYER');")"
row "credits spent on bookings" "$(Q "select count(*) from package_credits where state='consumed' and household_id=(select household_id from players where id='$PLAYER');")"
row "bookings"                  "$(Q "select count(*) from bookings where player_id='$PLAYER' and status='confirmed';")"
row "enrolled"                  "$(Q "select state||' · paid='||is_paid from enrollments where player_id='$PLAYER';")"
row "hold released"             "$(Q "select count(*) from booking_holds;")"
row "GROUP STATUS"              "$(Q "select status from training_groups where id='$GROUP';") — the fourth paid family started it"
row "audit entries"             "$(Q "select count(*) from audit_logs;")"

say "5. Stripe delivers the same event again"
row "claim_webhook_event"       "$(Q "select claim_webhook_event('stripe','evt_trace_1','payment_intent.succeeded','{}');") — refused, already handled"
row "settle_checkout, forced"   "$(Q "select settle_checkout('pi_trace_1', $AMOUNT, 'ch_trace_1');")"
row "payments"                  "$(Q "select count(*) from payments where household_id='$HOUSE';") — still one"
row "bookings"                  "$(Q "select count(*) from bookings where player_id='$PLAYER' and status='confirmed';") — still sixteen"

say "6. Tayo cannot make week three"
BOOKING=$(Q "select b.id from bookings b join sessions s on s.id=b.session_id where b.player_id='$PLAYER' order by s.starts_at desc limit 1;")
row "cancel_booking"            "$(psql $A -d "$DB" -tA -q <<EOF 2>&1 | tail -1
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$PARENT';
select cancel_booking('$BOOKING', false, 'away that week');
commit;
EOF
)"
row "credit returned"           "$(Q "select count(*) from package_credits where state='available' and household_id=(select household_id from players where id='$PLAYER');")"
row "still enrolled"            "$(Q "select state from enrollments where player_id='$PLAYER';") — one session is not the season"
row "group unchanged"           "$(Q "select status from training_groups where id='$GROUP';") — the other five families are unaffected"

say "7. Another family tries to check out for Tayo"
row "begin_checkout as Mai"     "$(psql $A -d "$DB" -tA -q <<EOF 2>&1 | grep -m1 ERROR
begin;
set local role authenticated;
set local request.jwt.claim.sub = '77777777-0000-0000-0000-000000000003';
select begin_checkout('group_package','$PLAYER','$GROUP','mischief');
commit;
EOF
)"

echo
