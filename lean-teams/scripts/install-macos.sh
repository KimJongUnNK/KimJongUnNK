#!/bin/bash
# Installs (or updates) Lean Teams on macOS from the latest build:
#
#   curl -fsSL https://raw.githubusercontent.com/KimJongUnNK/KimJongUnNK/claude/nifty-ptolemy-d2ami7/lean-teams/scripts/install-macos.sh | bash
#
# Downloads the universal .dmg, copies the app to /Applications, clears the
# Gatekeeper quarantine flag (the build is ad-hoc signed, not notarized) and
# starts it.

set -euo pipefail

URL=${LEAN_TEAMS_DMG_URL:-"https://github.com/KimJongUnNK/KimJongUnNK/releases/download/lean-teams-latest/LeanTeams-macOS-universal.dmg"}
APP="/Applications/Lean Teams.app"

TMP=$(mktemp -d)
cleanup() {
    hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true
    rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading Lean Teams..."
curl -fL --progress-bar -o "$TMP/LeanTeams.dmg" "$URL"

echo "Installing to $APP..."
hdiutil attach "$TMP/LeanTeams.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"
# Replace a running older version.
pkill -f "$APP/Contents/MacOS/lean-teams" 2>/dev/null || true
rm -rf "$APP"
cp -R "$TMP/mnt/Lean Teams.app" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "Done. Starting Lean Teams (look for the LT icon in the menu bar)."
open "$APP"
