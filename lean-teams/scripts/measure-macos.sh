#!/bin/bash
# Compares RAM and disk usage of Microsoft Teams and Lean Teams on macOS.
#
# RAM: resident memory (RSS) of each app's whole footprint, averaged over
# several samples:
#   - Microsoft Teams: MSTeams plus its child processes (the bundled
#     WebView2/Chromium helpers).
#   - Lean Teams: the lean-teams process plus the system WebKit processes
#     (com.apple.WebKit.WebContent/Networking/GPU) working for it. Those are
#     XPC services, not child processes, so they are matched by their
#     "responsible process". Reading that needs root: run with sudo for an
#     exact number. Without sudo, every WebKit process on the machine is
#     counted (Safari, Mail, ...), which gives an upper bound.
#
# Disk: app bundle plus per-user data (caches, WebKit storage, containers).
#
# For a fair comparison: start both apps, sign in to the same account, open
# the same chat, wait two minutes, then run:
#
#   sudo bash measure-macos.sh
#
# Options via environment: SAMPLES (default 5), INTERVAL in seconds (default 2).
# Written for the bash 3.2 that ships with macOS.

set -u

SAMPLES=${SAMPLES:-5}
INTERVAL=${INTERVAL:-2}
# Overridable for testing on other systems.
TEAMS_PATTERN=${TEAMS_PATTERN:-"/Microsoft Teams.app/Contents/MacOS/"}
LEAN_PATTERN=${LEAN_PATTERN:-"/Lean Teams.app/Contents/MacOS/lean-teams"}
WEBKIT_PATTERN=${WEBKIT_PATTERN:-"com.apple.WebKit."}

IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1
# Under sudo, $HOME may point at root; measure the invoking user's data.
USER_HOME=$HOME
if [ -n "${SUDO_USER:-}" ]; then
    USER_HOME=$(eval echo "~$SUDO_USER")
fi

# PIDs whose executable path contains $1 (fixed string). Processes that only
# carry it as an argument (this script's own awk, shells, `open`) are skipped:
# the text before the match must not contain an option or assignment.
pids_matching() {
    ps -axo pid=,command= | awk -v pat="$1" '{
        pid = $1; cmd = $0; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", cmd)
        at = index(cmd, pat)
        if (at == 0) next
        before = substr(cmd, 1, at - 1)
        if (index(before, " -") || index(before, "=")) next
        print pid
    }'
}

# $1 plus all its descendants, one per line.
with_descendants() {
    ps -axo pid=,ppid= | awk -v roots="$1" '
        BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) keep[r[i]] = 1 }
        { parent[$1] = $2 }
        END {
            do {
                added = 0
                for (p in parent) if (!(p in keep) && (parent[p] in keep)) { keep[p] = 1; added = 1 }
            } while (added)
            for (p in keep) print p
        }'
}

# Responsible PID of $1 as reported by launchd (root only), empty otherwise.
responsible_pid() {
    launchctl procinfo "$1" 2>/dev/null | awk -F'= ' 'tolower($0) ~ /^[[:space:]]*responsible pid/ { print $2; exit }'
}

# Sum of RSS in KB for the given PIDs (space separated).
rss_kb() {
    [ -z "$1" ] && { echo 0; return; }
    # shellcheck disable=SC2086
    ps -o rss= -p "$(echo $1 | tr ' ' ',')" 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'
}

join() { tr '\n' ' ' | sed 's/ *$//'; }

teams_pids() {
    local roots
    roots=$(pids_matching "$TEAMS_PATTERN" | join)
    [ -n "$roots" ] && with_descendants "$roots" | join
}

# Prints "<pids>|<exact>" where exact is 1 if WebKit helpers were attributed
# by responsible PID and 0 if all WebKit processes were counted.
lean_pids() {
    local roots tree webkit pid owner own exact=1
    roots=$(pids_matching "$LEAN_PATTERN" | join)
    [ -z "$roots" ] && { echo "|1"; return; }
    tree=$(with_descendants "$roots" | join)
    webkit=$(pids_matching "$WEBKIT_PATTERN" | join)
    own=""
    for pid in $webkit; do
        case " $tree " in *" $pid "*) continue ;; esac
        if [ "$IS_ROOT" -eq 1 ]; then
            owner=$(responsible_pid "$pid")
            if [ -n "$owner" ]; then
                case " $roots " in *" $owner "*) own="$own $pid" ;; esac
                continue
            fi
        fi
        exact=0
        own="$own $pid"
    done
    echo "$tree$own|$exact"
}

du_kb() {
    local total=0 path size
    for path in "$@"; do
        [ -e "$path" ] || continue
        size=$(du -sk "$path" 2>/dev/null | awk '{ print $1 }')
        total=$((total + ${size:-0}))
    done
    echo "$total"
}

mb() { awk -v kb="$1" 'BEGIN { if (kb <= 0) print "-"; else printf "%.0f MB", kb / 1024 }'; }

# --- RAM ---------------------------------------------------------------------
echo "Sampling memory ($SAMPLES x every ${INTERVAL}s)..."
teams_sum=0; teams_n=0; teams_procs=0
lean_sum=0; lean_n=0; lean_procs=0; lean_exact=1
i=0
while [ "$i" -lt "$SAMPLES" ]; do
    pids=$(teams_pids)
    if [ -n "$pids" ]; then
        teams_sum=$((teams_sum + $(rss_kb "$pids"))); teams_n=$((teams_n + 1))
        teams_procs=$(echo "$pids" | wc -w | tr -d ' ')
    fi
    result=$(lean_pids)
    pids=${result%|*}
    [ "${result#*|}" = "0" ] && lean_exact=0
    pids=$(echo "$pids" | sed 's/^ *//')
    if [ -n "$pids" ]; then
        lean_sum=$((lean_sum + $(rss_kb "$pids"))); lean_n=$((lean_n + 1))
        lean_procs=$(echo "$pids" | wc -w | tr -d ' ')
    fi
    i=$((i + 1))
    [ "$i" -lt "$SAMPLES" ] && sleep "$INTERVAL"
done
teams_ram=0; lean_ram=0
[ "$teams_n" -gt 0 ] && teams_ram=$((teams_sum / teams_n))
[ "$lean_n" -gt 0 ] && lean_ram=$((lean_sum / lean_n))

# --- Disk --------------------------------------------------------------------
teams_app=$(du_kb "/Applications/Microsoft Teams.app")
teams_data=$(du_kb \
    "$USER_HOME/Library/Containers/com.microsoft.teams2" \
    "$USER_HOME/Library/Group Containers/UBF8T346G9.com.microsoft.teams" \
    "$USER_HOME/Library/Application Support/Microsoft/Teams")
lean_app=$(du_kb "/Applications/Lean Teams.app")
lean_data=$(du_kb \
    "$USER_HOME/Library/Application Support/dev.leanteams.app" \
    "$USER_HOME/Library/WebKit/dev.leanteams.app" \
    "$USER_HOME/Library/Caches/dev.leanteams.app" \
    "$USER_HOME/Library/HTTPStorages/dev.leanteams.app")

# --- Report ------------------------------------------------------------------
echo
printf '%-16s %-8s %-10s %-10s %-10s %-10s %-10s\n' App Running Processes RAM\ \(RSS\) App\ bundle User\ data Disk\ total
row() {
    local running=no
    [ "$3" -gt 0 ] && running=yes
    printf '%-16s %-8s %-10s %-10s %-10s %-10s %-10s\n' \
        "$1" "$running" "$2" "$(mb "$3")" "$(mb "$4")" "$(mb "$5")" "$(mb $(($4 + $5)))"
}
row "Microsoft Teams" "$teams_procs" "$teams_ram" "$teams_app" "$teams_data"
row "Lean Teams" "$lean_procs" "$lean_ram" "$lean_app" "$lean_data"
echo

if [ "$teams_ram" -gt 0 ] && [ "$lean_ram" -gt 0 ]; then
    awk -v a="$lean_ram" -v b="$teams_ram" 'BEGIN { printf "RAM: Lean Teams uses %.0f%% of Microsoft Teams\n", 100 * a / b }'
fi
teams_disk=$((teams_app + teams_data)); lean_disk=$((lean_app + lean_data))
if [ "$teams_disk" -gt 0 ] && [ "$lean_disk" -gt 0 ]; then
    awk -v a="$lean_disk" -v b="$teams_disk" 'BEGIN { printf "Disk: Lean Teams uses %.0f%% of Microsoft Teams\n", 100 * a / b }'
fi
[ "$teams_n" -eq 0 ] && echo "Microsoft Teams is not running - start it to include its RAM usage."
[ "$lean_n" -eq 0 ] && echo "Lean Teams is not running - start it to include its RAM usage."
if [ "$lean_n" -gt 0 ] && [ "$lean_exact" -eq 0 ]; then
    echo "Note: Lean Teams RAM includes every WebKit process on this Mac (Safari, Mail, ...)."
    echo "      Run with sudo for the exact number, or quit other WebKit apps first."
fi
if [ "$IS_ROOT" -eq 0 ] && [ -d "$USER_HOME/Library/Containers/com.microsoft.teams2" ]; then
    echo "Note: macOS may hide parts of other apps' containers; grant Terminal Full Disk Access if Teams' user data looks too small."
fi
