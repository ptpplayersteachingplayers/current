#!/usr/bin/env bash
# =============================================================================
# Put this schema on a staging database.
#
#   ./stage.sh "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres"
#   ./stage.sh --local                    # the throwaway local Postgres
#
# Options:
#   --with-agent    also install modules/agent (off by default — the platform
#                   is meant to run without it, and staging should prove that)
#   --no-seed       schema only, no demo data. Use this the moment the staging
#                   database has anything real in it.
#   --dry-run       list what would be applied, touch nothing
#
# What this does NOT do: drop anything, or run verify.sh. verify.sh builds a
# database from scratch and is safe only against a throwaway — pointing it at
# a staging URL would drop that database. It is a separate command on purpose.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")"

TARGET=""; WITH_AGENT=0; SEED=1; DRY=0
for arg in "$@"; do
  case "$arg" in
    --with-agent) WITH_AGENT=1 ;;
    --no-seed)    SEED=0 ;;
    --dry-run)    DRY=1 ;;
    --local)      TARGET="local" ;;
    -*)           echo "unknown option: $arg" >&2; exit 2 ;;
    *)            TARGET="$arg" ;;
  esac
done

if [ -z "$TARGET" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

if [ "$TARGET" = "local" ]; then
  PSQL=(psql -h "${PGHOST:-/tmp/pgtest/sock}" -p "${PGPORT:-5433}" -U "${PGUSER:-postgres}" -d "${DB:-ptp_stage}")
  WHERE="local ${DB:-ptp_stage}"
else
  PSQL=(psql "$TARGET")
  WHERE="$(echo "$TARGET" | sed -E 's#//[^@]*@#//***@#')"
fi

FILES=(migrations/*.sql)
[ "$SEED" -eq 1 ] && FILES+=(seed/*.sql)
[ "$WITH_AGENT" -eq 1 ] && FILES+=(modules/agent/0*.sql)

echo "Target: $WHERE"
echo "Applying ${#FILES[@]} file(s)$([ "$SEED" -eq 0 ] && echo ', schema only')$([ "$WITH_AGENT" -eq 1 ] && echo ', with the agent module')"
echo

if [ "$DRY" -eq 1 ]; then
  printf '  %s\n' "${FILES[@]}"
  echo; echo "(dry run — nothing was applied)"
  exit 0
fi

# Supabase provides auth.uid() and auth.jwt(); a bare Postgres does not. This
# is a no-op against a real Supabase project.
"${PSQL[@]}" -q >/dev/null 2>&1 <<'BOOTSTRAP'
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'uid') then
    execute $f$create function auth.uid() returns uuid language sql stable as
      'select nullif(coalesce(nullif(current_setting(''request.jwt.claims'', true), ''''), ''{}'')::jsonb ->> ''sub'', '''')::uuid'$f$;
    execute $f$create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb, ''{}''::jsonb)'$f$;
  end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
grant usage on schema auth to anon, authenticated;
BOOTSTRAP

# These migrations are forward-only: they create types and tables without
# "if not exists", because a migration that quietly does nothing the second
# time is how two environments drift apart. So say what is happening rather
# than letting the first CREATE TYPE fail with something cryptic.
ALREADY=$("${PSQL[@]}" -tAc "select to_regclass('public.training_groups') is not null;" 2>/dev/null | tr -d '[:space:]')
if [ "$ALREADY" = "t" ]; then
  echo "This database already has the schema."
  echo
  echo "These migrations are forward-only — re-applying them will fail on the"
  echo "first CREATE TYPE. To re-stage, use a fresh database, or apply only the"
  echo "specific new migration:"
  echo
  echo "    psql \"\$TARGET\" -v ON_ERROR_STOP=1 -f migrations/00NN_name.sql"
  exit 1
fi

failed=0
for f in "${FILES[@]}"; do
  if "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/stage-out.log 2>&1; then
    printf "  ok   %s\n" "$f"
  else
    printf "  FAIL %s\n" "$f"
    grep -E 'ERROR:' /tmp/stage-out.log | head -3 | sed 's/^/         /'
    failed=1
    break
  fi
done

echo
if [ "$failed" -ne 0 ]; then
  echo "Stopped at the first failure. Nothing after it was applied."
  exit 1
fi

echo "Schema is on $WHERE."
echo
echo "Next, in this order:"
echo "  1. Set the function secrets:  supabase secrets set --env-file .env.staging"
echo "  2. Deploy the edge functions: supabase functions deploy"
echo "  3. Take one test-mode payment. That is the first time any of this runs."
echo
echo "See STAGING.md for the whole hour, and what to check after each step."
