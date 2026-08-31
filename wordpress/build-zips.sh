#!/usr/bin/env bash
# =============================================================================
# Package each plugin as a zip WordPress will accept at
# Plugins → Add New → Upload Plugin.
#
#   ./build-zips.sh          # writes to dist/ at the repo root (gitignored)
#
# Runs the test suite first and refuses to package a failing build, because a
# zip is the one artefact nobody reads before installing.
#
# There is no dependency step: the plugins call Stripe over wp_remote_post and
# autoload their own classes, so what is in the directory is what runs.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIST="$ROOT/dist"

echo "Running the test suite…"
php tests/run.php >/tmp/ptp-wp-tests.log 2>&1 || {
  echo "  REFUSING to package — tests fail:"; grep -E 'FAILED|failed' /tmp/ptp-wp-tests.log | head; exit 1; }
echo "  ok   $(grep -oE '[0-9]+ passed' /tmp/ptp-wp-tests.log | awk '{s+=$1} END {print s}') assertions passed"

echo "Linting…"
find . ../wordpress-plugin -name '*.php' -print0 | while IFS= read -r -d '' f; do
  php -l "$f" >/dev/null || { echo "  syntax error in $f"; exit 1; }
done
echo "  ok   every file parses"

mkdir -p "$DIST"
package() { # package <source-dir> <plugin-slug>
  local src="$1" slug="$2"
  rm -f "$DIST/$slug.zip"
  ( cd "$(dirname "$src")" && zip -qr "$DIST/$slug.zip" "$(basename "$src")" \
      -x '*/.*' -x '*/tests/*' -x '*.zip' )
  printf "  %-16s %s\n" "$slug" "$(du -h "$DIST/$slug.zip" | cut -f1)"
}

echo "Packaging…"
package "$ROOT/wordpress/ptp-core"                  ptp-core
package "$ROOT/wordpress/ptp-public"                ptp-public
package "$ROOT/wordpress/ptp-admin"                 ptp-admin
package "$ROOT/wordpress/ptp-marketing"             ptp-marketing
package "$ROOT/wordpress-plugin/ptp-mobile-api"     ptp-mobile-api

echo
echo "Written to dist/. Activate PTP Core first — the other three hook"
echo "ptp_core_ready and do nothing without it."
