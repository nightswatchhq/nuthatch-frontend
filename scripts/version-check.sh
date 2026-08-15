#!/usr/bin/env bash
# Find every place the site states a nuthatch version, and flag any that is not the current release.
#
#   ./scripts/version-check.sh            # checks against the latest GitHub release
#   ./scripts/version-check.sh 2.5.0      # checks against a version you name
#
# Written after 2026-08-15, when a release pass took three attempts. The first missed `llms.txt`
# entirely (it still said v1.0.2 - four majors stale, in the file coding agents read). The second
# missed the **hero tag on the homepage**, the single most prominent version string on the site,
# because the sweep matched prose like "current release" and a bare `v2.2.0` in a `<span class="tag">`
# matched nothing.
#
# The lesson is not "look harder". It is that a version is a claim, and claims want a checker.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WANT=${1:-}
if [ -z "$WANT" ]; then
  WANT=$(curl -fsS -m 20 https://api.github.com/repos/nightswatchhq/nuthatch/releases/latest 2>/dev/null \
         | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
fi
[ -z "$WANT" ] && { echo "could not determine the current version; pass it as an argument"; exit 2; }
echo "current release: $WANT"
echo

# Any x.y.z that is not the wanted one, in files a reader or an agent actually sees.
# `blog/` is excluded on purpose: a post is dated writing and should keep the version it shipped with.
stale=0
while IFS= read -r line; do
  f=${line%%:*}
  case "$f" in
    */blog/*) continue ;;
  esac
  echo "  $line"
  stale=$((stale + 1))
done < <(grep -rnoE "v?[0-9]+\.[0-9]+\.[0-9]+" src public 2>/dev/null \
         | grep -vE ":v?${WANT//./\\.}$" \
         | grep -viE "glibc|node|astro|tailwind|typescript|schema_version|rust|1\.95\.0" \
         | grep -vE "127\.0\.0|0\.0\.0|192\.168|10\.[0-9]+\.[0-9]+" )   # IPs, not versions

echo
if [ "$stale" -gt 0 ]; then
  echo "$stale version reference(s) not on $WANT - check each: some are legitimate history"
  echo "(a line like 'When cold data is damaged (2.2.0)' is a fact about a past release; leave it)"
else
  echo "no stale version references"
fi

echo
echo "the four that have bitten before, checked explicitly:"
for probe in \
  'src/pages/index.astro|hero tag' \
  'src/pages/install.astro|install page + docker tag' \
  'public/llms.txt|what agents read' \
  'public/llms-full.txt|what agents read'
do
  f=${probe%%|*}; what=${probe##*|}
  if [ -f "$f" ]; then
    if grep -q "$WANT" "$f"; then printf "  OK      %-26s (%s)\n" "$f" "$what"
    else                          printf "  MISSING %-26s (%s)  <-- states no current version\n" "$f" "$what"; fi
  fi
done
