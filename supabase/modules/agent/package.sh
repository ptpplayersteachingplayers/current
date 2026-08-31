#!/usr/bin/env bash
# =============================================================================
# Package the agent module.
#
#   ./package.sh              # writes dist/ptp-agent-module.zip and the
#                             # paste-ready dist/ptp-agent.sql
#
# This is NOT a WordPress plugin. It installs into Supabase: two SQL files and
# four edge functions. install.sh inside the zip does both halves.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"
DIST="$(cd ../../.. && pwd)/dist"
mkdir -p "$DIST"

# The zip, laid out so it can be unpacked straight into supabase/modules/.
rm -f "$DIST/ptp-agent-module.zip"
( cd .. && zip -qr "$DIST/ptp-agent-module.zip" agent -x '*/.*' )

# One SQL file for the dashboard's editor, for when the CLI is not an option.
{
  cat <<'HDR'
-- =============================================================================
-- PTP agent module — install
-- =============================================================================
-- Paste into the Supabase SQL editor and run, AFTER the platform's own
-- migrations. It registers the module, its two scheduled jobs and the one
-- number it contributes to the weekly summary.
--
-- This is the database half. The four edge functions (agent, quo-webhook,
-- email-inbound, hubspot-sync) still need deploying — see the module README.
--
-- To remove it again, run 999_uninstall.sql from the zip. That drops what is
-- below and leaves every message, thread and consent record untouched.
-- =============================================================================

HDR
  for f in 010_install.sql 020_hubspot.sql; do
    printf '\n-- ─────────────────────────────────────────────────────────────────────\n'
    printf -- '-- %s\n' "$f"
    printf -- '-- ─────────────────────────────────────────────────────────────────────\n'
    cat "$f"
  done
} > "$DIST/ptp-agent.sql"

printf "  %-26s %s\n" "ptp-agent-module.zip" "$(du -h "$DIST/ptp-agent-module.zip" | cut -f1)"
printf "  %-26s %s\n" "ptp-agent.sql" "$(du -h "$DIST/ptp-agent.sql" | cut -f1)"
