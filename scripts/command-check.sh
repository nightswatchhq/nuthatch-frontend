#!/usr/bin/env bash
# Does every `nuthatch ...` command the agent-facing files teach exist in the release this site documents?
#
# nuthatch#769: public/llms.txt told coding agents to run `nuthatch roost` for five releases after the
# subcommand was removed. nuthatch's own tests/doc_command_check.rs checks its repo's docs against clap,
# but cannot see these two files, which live here (#41). This is that check for them.
#
# The ground truth is `skills/nuthatch-builder/cli-reference.md` at the release tag, generated from clap
# by `nuthatch skill-refs`. The tag, not `main`: the site documents a released version, and a command on
# `main` that has not shipped is as wrong here as one that was removed.
#
# Usage: scripts/command-check.sh <version>        e.g. scripts/command-check.sh 3.13.3
set -euo pipefail

WANT="${1:?usage: command-check.sh <version>}"
FILES=(public/llms.txt public/llms-full.txt)
ALLOW=scripts/command-allow.txt
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

tmp="$(mktemp -d)"
REF_URL="https://raw.githubusercontent.com/nuthatch-org/nuthatch/v${WANT}/skills/nuthatch-builder/cli-reference.md"
# No fallback: a reference we could not fetch is not a pass.
if ! curl -fsSL "$REF_URL" -o "$tmp/ref.md"; then
  echo "FAIL: could not fetch the CLI reference for v${WANT} ($REF_URL)" >&2
  rm -rf "$tmp"
  exit 1
fi

# One line per command path ("" for the global section), and "<path>|<flag>" per flag.
awk '
  /^## `nuthatch/ {
    line = $0
    sub(/^## `nuthatch ?/, "", line); sub(/`.*$/, "", line); sub(/ *\(.*$/, "", line)
    cmd = line; print cmd > CMDS; next
  }
  /^- `--/ {
    f = $0; sub(/^- `/, "", f); sub(/[ `=<].*$/, "", f)
    print cmd "|" f > FLAGS
  }
' CMDS="$tmp/cmds" FLAGS="$tmp/flags" "$tmp/ref.md"

if [ "$(wc -l < "$tmp/cmds")" -lt 10 ]; then
  echo "FAIL: the v${WANT} reference parsed to fewer than 10 commands - the format changed" >&2
  rm -rf "$tmp"
  exit 1
fi

known_cmd() { grep -qxF -- "$1" "$tmp/cmds"; }
known_flag() {  # known_flag <cmd path> <flag>
  case "$2" in --help|--version|-h|-V) return 0 ;; esac
  grep -qxF -- "$1|$2" "$tmp/flags" || grep -qxF -- "|$2" "$tmp/flags"
}

# Invocations: inline `nuthatch ...` spans anywhere, and lines inside a fence that start with it.
: > "$tmp/found"
for f in "${FILES[@]}"; do
  awk -v F="$f" '
    /^[[:space:]]*```/ { fence = !fence; next }
    {
      s = $0
      while (match(s, /`nuthatch [^`]*`/)) {
        print F "\t" NR "\t" substr(s, RSTART + 1, RLENGTH - 2)
        s = substr(s, RSTART + RLENGTH)
      }
      if (fence) {
        t = $0; sub(/^[[:space:]]*(\$ )?/, "", t)
        if (t ~ /^nuthatch /) { sub(/[[:space:]]+#.*$/, "", t); print F "\t" NR "\t" t }
      }
    }
  ' "$f" >> "$tmp/found"
done

: > "$tmp/bad"
while IFS=$'\t' read -r file line inv; do
  # shellcheck disable=SC2086
  set -- $inv
  shift  # "nuthatch"
  path=""
  resolved=0
  # Walk subcommand words while they extend a known path.
  while [ $# -gt 0 ]; do
    tok="$1"
    case "$tok" in -*|\<*|\[*|\{*|\"*|\'*|*…*|*...*|\|*|\&*|\>*) break ;; esac
    # `publish sync|verify|status` names several subcommands at once; every one must exist.
    case "$tok" in *\|*)
      alts_ok=1
      for alt in $(printf '%s' "$tok" | tr '|' ' '); do
        known_cmd "${path:+$path }$alt" || alts_ok=0
      done
      if [ "$alts_ok" = 1 ]; then resolved=1; path="${path:+$path }${tok%%|*}"; shift; fi
      break ;;
    esac
    next="${path:+$path }$tok"
    if known_cmd "$next"; then path="$next"; resolved=1; shift; else break; fi
  done
  # A bare word where a subcommand must go: first after `nuthatch`, or after a command that has
  # subcommands of its own (`nest bundel` is a typo, not `nest` with an argument).
  has_children=0
  if [ -n "$path" ] && grep -q "^$path " "$tmp/cmds"; then has_children=1; fi
  if { [ "$resolved" = 0 ] || [ "$has_children" = 1 ]; } && [ $# -gt 0 ]; then
    case "$1" in -*|\<*|\[*|*…*|*...*) ;; *) echo "$file:$line	$1	unknown subcommand in: $inv" >> "$tmp/bad" ;; esac
  fi
  for tok in "$@"; do
    case "$tok" in
      --*) flag="${tok%%=*}"; flag="${flag%%[,.;:)]*}"
           known_flag "$path" "$flag" || echo "$file:$line	$flag	no such flag on \`nuthatch $path\`: $inv" >> "$tmp/bad" ;;
    esac
  done
done < "$tmp/found"

# Allow-list: "<file>\t<token>\t<count>\t<reason>". A token may appear that many times in that file and
# no more, so a deliberate mention ("there is no `roost` subcommand") stands while a new one still fails.
status=0
if [ -s "$tmp/bad" ]; then
  cut -f1,2 "$tmp/bad" | sed 's/:[0-9]*\t/\t/' | sort | uniq -c | while read -r n file tok; do
    allowed=$(awk -F'\t' -v f="$file" -v t="$tok" '$1==f && $2==t {print $3}' "$ALLOW" 2>/dev/null | head -1)
    if [ -z "$allowed" ] || [ "$n" -gt "$allowed" ]; then
      grep -F "$file:" "$tmp/bad" | awk -F'\t' -v t="$tok" '$2==t' | sed 's/^/  /'
      echo "x"
    fi
  done > "$tmp/fail"
  if grep -qx x "$tmp/fail"; then
    grep -vx x "$tmp/fail"
    status=1
  fi
fi

checked=$(wc -l < "$tmp/found" | tr -d ' ')
rm -rf "$tmp"
if [ "$status" = 0 ]; then
  echo "every one of ${checked} nuthatch invocations in the agent-facing files resolves against v${WANT}."
else
  echo "FAIL: the agent-facing files teach commands v${WANT} does not have." >&2
fi
exit "$status"
