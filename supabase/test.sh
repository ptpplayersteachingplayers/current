#!/usr/bin/env bash
# Everything that can be executed, executed.
#
#   ./test.sh
#
# verify.sh needs a PostgreSQL 16 with pgcrypto, citext and btree_gist.
# The signature test needs Node 22.6+ for native TypeScript stripping — it
# imports the real _shared/signature.ts rather than a copy of it.
set -uo pipefail
cd "$(dirname "$0")"

failed=0

./verify.sh || failed=1
echo

if command -v node >/dev/null 2>&1; then
  node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
    functions/tests/signature.test.mjs || failed=1
else
  echo "  skipped: node not installed, Stripe signature test not run"
  failed=1
fi

exit $failed
