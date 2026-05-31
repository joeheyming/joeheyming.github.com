#!/usr/bin/env bash
# Walk sitemap URLs, request indexing for any URL not on Google.
# Priority URLs (new + never-submitted + recently-rewritten) run first,
# then everything else from sitemap.xml in document order.
# Stops after GSC_MAX_REQUESTS (default 10) or when GSC quota is exhausted.
#
# Prereq: open a logged-in playwright-cli session named "gsc":
#   playwright-cli -s=gsc open \
#     "https://search.google.com/search-console?resource_id=https%3A%2F%2Fjoeheyming.github.io%2F" \
#     --profile=scripts/.gsc-profile --headed
#
# Noindex redirect stubs (intentionally absent from sitemap.xml and skipped):
#   /sega/           -> /emulator/?console=sega
#   /nes/            -> /emulator/?console=nes
#   /legend-of-doom/ -> /doom/?flavor=legend
#   /play/guitar/    -> /play/strings/
#   /simpletons/     -> /watch/?show=simpsons
# Each has <meta name="robots" content="noindex"> and a meta-refresh; do not
# add them to the priority list.

set -u

MAX_REQUESTS="${GSC_MAX_REQUESTS:-10}"
SITEMAP="${GSC_SITEMAP:-sitemap.xml}"
RESULTS="${GSC_RESULTS:-scripts/.gsc-results.md}"
REQUESTED=0

# Priority queue: URLs to inspect before the sitemap sweep. Leave empty for a
# pure sitemap-order audit run.
#
# The current priority list reflects pages most affected by the GEO/AEO rollout
# on 2026-05-31: Tier 1 content rewrites, Tier 3 AI experiences (high AEO
# interest), and pages that gained full JSON-LD where they had none. Drop or
# rearrange entries as fresh ones become more important.
PRIORITY=(
  "https://joeheyming.github.io/"
  "https://joeheyming.github.io/programming-advice/"
  "https://joeheyming.github.io/vibe-coding/"
  "https://joeheyming.github.io/about/"
  "https://joeheyming.github.io/chat/"
  "https://joeheyming.github.io/imagine/"
  "https://joeheyming.github.io/code-ide/"
  "https://joeheyming.github.io/pacman-infinite/"
  "https://joeheyming.github.io/accordion-hero/"
  "https://joeheyming.github.io/farm/"
)

# Skip URLs submitted recently — Google's first-crawl latency is typically
# 3–7 days, so resubmitting within that window just wastes a quota slot.
# Leave empty for a full audit (re-checks every URL, resubmits any laggards).
SKIP_RECENT=()

# Pull all <loc> values from the sitemap.
SITEMAP_URLS=()
while IFS= read -r line; do
  [ -n "$line" ] && SITEMAP_URLS+=("$line")
done < <(grep -oE '<loc>[^<]+</loc>' "$SITEMAP" | sed -E 's|</?loc>||g')

if [ "${#SITEMAP_URLS[@]}" -eq 0 ]; then
  echo "No <loc> entries found in $SITEMAP" >&2
  exit 1
fi

# Portable dedupe (bash 3.2 has no associative arrays).
in_array() {
  local needle="$1"
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

QUEUE=("${PRIORITY[@]}")
for url in "${SITEMAP_URLS[@]}"; do
  if in_array "$url" "${SKIP_RECENT[@]}"; then
    continue
  fi
  if ! in_array "$url" "${QUEUE[@]}"; then
    QUEUE+=("$url")
  fi
done

SWEEP_COUNT=$((${#QUEUE[@]} - ${#PRIORITY[@]}))
echo "Queue: ${#QUEUE[@]} URLs (${#PRIORITY[@]} priority, $SWEEP_COUNT sweep, ${#SKIP_RECENT[@]} skipped as recently-submitted)"
echo "Max requests this run: $MAX_REQUESTS"
echo ""

{
  echo ""
  echo "## $(date +%Y-%m-%d) (sitemap sweep)"
  echo ""
  echo "| URL | Result |"
  echo "| --- | --- |"
} >> "$RESULTS"

for url in "${QUEUE[@]}"; do
  echo ">>> $url"
  outcome=$(./scripts/gsc-inspect-url.sh "$url" request)
  echo "| $url | $outcome |" >> "$RESULTS"

  case "$outcome" in
    requested)
      REQUESTED=$((REQUESTED + 1))
      echo "  -> requested ($REQUESTED/$MAX_REQUESTS)"
      if [ "$REQUESTED" -ge "$MAX_REQUESTS" ]; then
        echo "Reached GSC_MAX_REQUESTS ($MAX_REQUESTS); stopping."
        break
      fi
      ;;
    quota)
      echo "  -> quota exceeded; stopping."
      break
      ;;
    indexed|indexed-with-issues)
      echo "  -> already indexed"
      ;;
    *)
      echo "  -> $outcome"
      ;;
  esac

  sleep 2
done

echo ""
echo "Done. Requests submitted this run: $REQUESTED"
echo "Log: $RESULTS"
