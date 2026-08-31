#!/usr/bin/env bash
# =============================================================================
# Install or remove the agent module.
#
#   ./install.sh install [DB]     apply the module's SQL, link its functions
#   ./install.sh uninstall [DB]   remove both
#
# The SQL half registers the module, its two scheduled jobs and its one
# reported metric. The filesystem half symlinks the module's edge functions
# into supabase/functions/ so `supabase functions deploy` finds them — the
# code stays here, and removing the module removes the links rather than
# leaving orphaned functions deployed.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"
MODE="${1:-install}"
DB="${2:-${DB:-ptp}}"
PSQL_ARGS="-h ${PGHOST:-/tmp/pgtest/sock} -p ${PGPORT:-5433} -U ${PGUSER:-postgres}"
FUNCS=(agent quo-webhook email-inbound hubspot-sync)

case "$MODE" in
  install)
    for f in 0*.sql; do
      echo "  applying $f"
      psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
    done
    for f in "${FUNCS[@]}"; do
      ln -sfn "../modules/agent/functions/$f" "../../functions/$f"
    done
    echo "  linked ${#FUNCS[@]} edge functions into supabase/functions"
    ;;
  uninstall)
    for f in "${FUNCS[@]}"; do
      [ -L "../../functions/$f" ] && rm "../../functions/$f"
    done
    psql $PSQL_ARGS -d "$DB" -v ON_ERROR_STOP=1 -q -f 999_uninstall.sql
    echo "  agent module removed"
    ;;
  *)
    echo "usage: $0 [install|uninstall] [database]" >&2; exit 2 ;;
esac
