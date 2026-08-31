#!/usr/bin/env bash
# =============================================================================
# Build paste-ready SQL for the Supabase dashboard's SQL editor.
#
#   ./bundle.sh                 # migrations + seed, into dist/
#   ./bundle.sh --no-seed       # schema only
#   ./bundle.sh --with-agent    # include the agent module
#
# For when the CLI is not an option. stage.sh over a connection string is the
# better route — it stops at the first failure and tells you which file. This
# splits the same SQL into parts small enough to paste, in the order they must
# run. Run each part to completion before starting the next.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

SEED=1; AGENT=0
for a in "$@"; do
  case "$a" in
    --no-seed) SEED=0 ;;
    --with-agent) AGENT=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

FILES=(migrations/*.sql)
[ "$SEED" -eq 1 ] && FILES+=(seed/*.sql)
[ "$AGENT" -eq 1 ] && FILES+=(modules/agent/0*.sql)

DIST=../dist; mkdir -p "$DIST"; rm -f "$DIST"/staging-part-*.sql

MAX=90000   # comfortably inside what the SQL editor will take in one paste
part=1; size=0; out="$DIST/staging-part-1.sql"

header() { # header <part>
  cat > "$DIST/staging-part-$1.sql" <<HDR
-- =============================================================================
-- PTP staging — part $1
-- =============================================================================
-- Paste into the Supabase SQL editor and run. Parts must run in order, and
-- each must finish before the next is started.
--
-- These files are forward-only: they create types and tables without
-- "if not exists", so running a part twice will fail on the first CREATE TYPE.
-- That is deliberate — a migration that quietly does nothing the second time
-- is how two environments drift apart. If you need to start over, reset the
-- database rather than re-running a part.
-- =============================================================================

HDR
}

header 1
for f in "${FILES[@]}"; do
  fsize=$(wc -c < "$f")
  if [ "$size" -gt 0 ] && [ $((size + fsize)) -gt "$MAX" ]; then
    part=$((part + 1)); out="$DIST/staging-part-$part.sql"; header "$part"; size=0
  fi
  {
    echo ""
    echo "-- ─────────────────────────────────────────────────────────────────────"
    echo "-- $f"
    echo "-- ─────────────────────────────────────────────────────────────────────"
    cat "$f"
  } >> "$out"
  size=$((size + fsize))
done

echo "Wrote $part part(s) to dist/:"
for p in $(seq 1 "$part"); do
  printf "  staging-part-%d.sql  %6s  — %s\n" "$p" \
    "$(du -h "$DIST/staging-part-$p.sql" | cut -f1)" \
    "$(grep -oE '(migrations|seed|modules)/[a-z0-9_/]+\.sql' "$DIST/staging-part-$p.sql" | head -1) …"
done
