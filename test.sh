#!/usr/bin/env bash
# Everything in this repository that can be executed, executed.
#
#   ./test.sh
#
# Needs PostgreSQL 16 for the database rules and Node 22.6+ for the rest.
# The browser tests additionally need `npm i playwright`; they are skipped,
# loudly, if it is not installed.
set -uo pipefail
cd "$(dirname "$0")"

failed=0
run() {
  echo
  echo "── $1 ──────────────────────────────────────────────────────"
  shift
  "$@" || failed=1
}

run "database rules" ./supabase/verify.sh
run "stripe signature" node --experimental-strip-types \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/tests/signature.test.mjs
run "portal logic" node web/tests/derive.test.mjs

echo
echo "── portals in a browser ────────────────────────────────────"
if [ -d node_modules/playwright ]; then
  node web/tests/browser.test.mjs || failed=1
else
  echo "  skipped: run 'npm i playwright' to run these"
fi

echo
if [ "$failed" -eq 0 ]; then echo "All green."; else echo "Something failed above."; fi
exit $failed
