#!/bin/bash
# Installs (or updates) Dorion, an open-source Discord client that uses the
# macOS WebKit engine instead of bundling Chromium like the official app:
#
#   curl -fsSL https://raw.githubusercontent.com/KimJongUnNK/KimJongUnNK/claude/nifty-ptolemy-d2ami7/mac-tools/install-dorion.sh | bash
#
# Picks the .dmg for this Mac's CPU from the latest release on
# github.com/SpikeHD/Dorion, copies the app to /Applications, clears the
# Gatekeeper quarantine flag (Dorion is not notarized) and starts it.

set -euo pipefail

API=https://api.github.com/repos/SpikeHD/Dorion/releases/latest
case "$(uname -m)" in
    arm64) ARCH_RE='aarch64|arm64|universal' ;;
    *) ARCH_RE='x64|x86_64|amd64|intel|universal' ;;
esac

auth=()
[ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

urls=$(curl -fsSL ${auth[@]+"${auth[@]}"} "$API" |
    grep -o '"browser_download_url": *"[^"]*\.dmg"' |
    sed -E 's/.*"(https[^"]+)"$/\1/')
url=$(printf '%s\n' "$urls" | grep -Ei "$ARCH_RE" | head -1 || true)
[ -n "$url" ] || url=$(printf '%s\n' "$urls" | head -1)
[ -n "$url" ] || { echo "No macOS .dmg found in the latest Dorion release." >&2; exit 1; }

TMP=$(mktemp -d)
cleanup() {
    hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true
    rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading $(basename "$url")..."
curl -fL --progress-bar -o "$TMP/Dorion.dmg" "$url"
hdiutil attach "$TMP/Dorion.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"

app=$(find "$TMP/mnt" -maxdepth 1 -name '*.app' | head -1)
[ -n "$app" ] || { echo "No app found inside the .dmg." >&2; exit 1; }
name=$(basename "$app")

echo "Installing to /Applications/$name..."
pkill -f "/Applications/$name/Contents/MacOS/" 2>/dev/null || true
rm -rf "/Applications/$name"
cp -R "$app" "/Applications/$name"
xattr -dr com.apple.quarantine "/Applications/$name" 2>/dev/null || true

echo "Done. Starting $name."
open "/Applications/$name"
