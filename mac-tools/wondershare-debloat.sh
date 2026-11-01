#!/bin/bash
# Removes the background services Wondershare installs next to Filmora on
# macOS (update helpers, "Wondershare Helper Compact", push/telemetry agents)
# without touching the Filmora app itself or your projects.
#
#   Preview (changes nothing):
#     curl -fsSL https://raw.githubusercontent.com/KimJongUnNK/KimJongUnNK/claude/nifty-ptolemy-d2ami7/mac-tools/wondershare-debloat.sh | bash
#   Apply:
#     curl -fsSL https://raw.githubusercontent.com/KimJongUnNK/KimJongUnNK/claude/nifty-ptolemy-d2ami7/mac-tools/wondershare-debloat.sh | bash -s -- --apply
#
# Nothing is deleted except caches and logs: launch agents, daemons, helper
# tools and helper apps are moved to ~/WondershareDebloat-Backup-<timestamp>
# so they can be put back. Filmora updates and some online features (cloud
# effects store, auto update) may need the helpers; reinstalling Filmora or
# moving the files back restores them. Filmora may reinstall its helpers on
# a later update, in which case just run this again.
#
# Written for the bash 3.2 that ships with macOS.

set -u

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Overridable for testing.
USER_HOME=${DEBLOAT_HOME:-$HOME}
SYS_ROOT=${DEBLOAT_ROOT:-}
LAUNCHCTL=${DEBLOAT_LAUNCHCTL:-launchctl}

BACKUP="$USER_HOME/WondershareDebloat-Backup-$(date +%Y%m%d-%H%M%S)"
UID_NUM=$(id -u)
found=0

say() { printf '%s\n' "$*"; }

size_of() { du -sh "$1" 2>/dev/null | awk '{ print $1 }'; }

# Runs a command, with sudo when the path is not ours to change.
as_owner() {
    local path=$1; shift
    if [ -w "$(dirname "$path")" ]; then "$@"; else sudo "$@"; fi
}

move_to_backup() {
    local path=$1
    mkdir -p "$BACKUP$(dirname "$path")"
    as_owner "$path" mv "$path" "$BACKUP$path"
}

# A plist belongs to Wondershare if its name or its program path says so.
is_wondershare_plist() {
    case "$(basename "$1" | tr '[:upper:]' '[:lower:]')" in *wondershare*|*wsupdate*|*wshelper*) return 0 ;; esac
    grep -qi 'wondershare' "$1" 2>/dev/null
}

handle_job() {
    local plist=$1 domain=$2 label
    label=$(basename "$plist" .plist)
    found=1
    say "  launchd job: $plist"
    if [ "$APPLY" -eq 1 ]; then
        as_owner "$plist" "$LAUNCHCTL" bootout "$domain/$label" 2>/dev/null || true
        move_to_backup "$plist" && say "    -> stopped and moved to backup"
    fi
}

handle_path() {
    local path=$1 what=$2
    found=1
    say "  $what: $path ($(size_of "$path"))"
    if [ "$APPLY" -eq 1 ]; then
        move_to_backup "$path" && say "    -> moved to backup"
    fi
}

delete_path() {
    local path=$1 what=$2
    found=1
    say "  $what: $path ($(size_of "$path"))"
    if [ "$APPLY" -eq 1 ]; then
        as_owner "$path" rm -rf "$path" && say "    -> deleted"
    fi
}

if [ "$APPLY" -eq 1 ]; then say "Removing Wondershare background services..."; else say "Preview - nothing is changed. Re-run with --apply to remove:"; fi
say

say "Background services (launch agents / daemons):"
for dir in "$USER_HOME/Library/LaunchAgents" "$SYS_ROOT/Library/LaunchAgents" "$SYS_ROOT/Library/LaunchDaemons"; do
    [ -d "$dir" ] || continue
    for plist in "$dir"/*.plist; do
        [ -f "$plist" ] || continue
        is_wondershare_plist "$plist" || continue
        case "$dir" in
            "$SYS_ROOT/Library/LaunchDaemons") handle_job "$plist" system ;;
            *) handle_job "$plist" "gui/$UID_NUM" ;;
        esac
    done
done

say "Privileged helper tools:"
for path in "$SYS_ROOT/Library/PrivilegedHelperTools"/*; do
    [ -e "$path" ] || continue
    case "$(basename "$path" | tr '[:upper:]' '[:lower:]')" in *wondershare*) handle_path "$path" "helper tool" ;; esac
done

say "Helper apps (not Filmora itself):"
# Top-level apps only count when Wondershare is in the name, so other vendors'
# updaters (e.g. "Microsoft AutoUpdate") are never touched. Apps inside
# Filmora's own bundle are left alone too: moving them would break its
# code signature.
for base in "$SYS_ROOT/Applications" "$USER_HOME/Applications"; do
    [ -d "$base" ] || continue
    for app in "$base"/*.app; do
        [ -d "$app" ] || continue
        name=$(basename "$app" | tr '[:upper:]' '[:lower:]')
        case "$name" in
            *filmora*) ;;
            *wondershare*) handle_path "$app" "helper app" ;;
        esac
    done
done
for base in "$USER_HOME/Library/Application Support/Wondershare" "$SYS_ROOT/Library/Application Support/Wondershare"; do
    [ -d "$base" ] || continue
    while IFS= read -r app; do
        name=$(basename "$app" | tr '[:upper:]' '[:lower:]')
        case "$name" in
            *filmora*) ;;
            *helper*|*update*|*push*) handle_path "$app" "helper app" ;;
        esac
    done < <(find "$base" -maxdepth 3 -type d -iname '*.app' -prune 2>/dev/null)
done

say "Caches and logs (safe to delete, rebuilt when needed):"
for path in "$USER_HOME/Library/Caches"/com.wondershare.* "$USER_HOME/Library/Caches"/Wondershare* "$USER_HOME/Library/Logs"/Wondershare* "$USER_HOME/Library/Logs"/com.wondershare.*; do
    [ -e "$path" ] || continue
    delete_path "$path" "cache/log"
done

say
if [ "$found" -eq 0 ]; then
    say "Nothing found - no Wondershare background services on this Mac."
elif [ "$APPLY" -eq 1 ]; then
    [ -d "$BACKUP" ] && say "Backup: $BACKUP (move files back to restore, or reinstall Filmora)."
    say "Done. The Filmora app itself was not touched. Restart the Mac so no helper keeps running."
else
    say "Run again with --apply to remove the items above."
fi
