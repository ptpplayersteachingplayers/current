#!/usr/bin/env bash
# =============================================================================
# Everything needed to stand the platform up on a development site, in one zip.
#
#   ./build-dev-bundle.sh
#
# Runs the whole test suite first and refuses to build if anything fails — a
# bundle is the one artefact nobody reads before installing.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"
DIST="$PWD/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Running the suite…"
./test.sh > /tmp/bundle-tests.log 2>&1 || { echo "  REFUSING to build — tests fail:"; grep -E 'FAIL' /tmp/bundle-tests.log | head; exit 1; }
TOTAL=$(grep -oE '[0-9]+ passed' /tmp/bundle-tests.log | awk '{s+=$1} END {print s}')
echo "  ok   $TOTAL assertions"

./wordpress/build-zips.sh >/dev/null
./supabase/bundle.sh      >/dev/null
./supabase/modules/agent/package.sh >/dev/null
echo "  ok   plugins, staging SQL and the agent module built"

B="$STAGE/ptp-dev"
mkdir -p "$B"/{1-wordpress-plugins,2-supabase-schema,3-agent-module,4-website,docs}

cp dist/ptp-core.zip dist/ptp-public.zip dist/ptp-admin.zip \
   dist/ptp-marketing.zip dist/ptp-mobile-api.zip "$B/1-wordpress-plugins/"

cp dist/staging-part-*.sql "$B/2-supabase-schema/"
cp supabase/stage.sh supabase/verify.sh supabase/.env.staging.example "$B/2-supabase-schema/"
cp -r supabase/migrations supabase/seed "$B/2-supabase-schema/"

cp dist/ptp-agent-module.zip dist/ptp-agent.sql "$B/3-agent-module/"

# The public site and the portals: static files that read Supabase directly.
cp -r web/* "$B/4-website/"
rm -rf "$B/4-website/tests"

cp supabase/STAGING.md          "$B/docs/"
cp supabase/README.md           "$B/docs/DATABASE.md"
cp web/README.md                "$B/docs/WEBSITE.md"
cp wordpress/README.md          "$B/docs/WORDPRESS-PLUGINS.md"
cp wordpress/MIGRATION.md       "$B/docs/"
cp wordpress/EVALUATION.md      "$B/docs/"
cp supabase/docs/THE-AGENT.md   "$B/docs/"
cp STATUS.md                    "$B/docs/"

sed "s/__TOTAL__/$TOTAL/" docs-src/DEV-BUNDLE-README.md > "$B/START-HERE.md"

rm -f "$DIST/ptp-dev-bundle.zip"
( cd "$STAGE" && zip -qr "$DIST/ptp-dev-bundle.zip" ptp-dev )
echo
echo "  dist/ptp-dev-bundle.zip  $(du -h "$DIST/ptp-dev-bundle.zip" | cut -f1)"
