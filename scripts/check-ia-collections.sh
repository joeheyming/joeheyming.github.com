#!/usr/bin/env bash
#
# Verify every Internet Archive item referenced by emulator/consoles.js is
# still servable.
#
# Items go dark long after they are wired up. The failure mode is nasty:
# archive.org/metadata/<id> still answers 200, but the body has no `files`
# and carries `"is_dark": true`, so the ROM browser falls through to the
# CORS proxies and the player just sees a wall of 404s in the console.
# Mocked browser tests cannot catch this — they stub the metadata call.
#
# Run it when adding a console, or when a collection stops listing games.
#
#   ./scripts/check-ia-collections.sh
#
# Exits non-zero if any item is dark, empty, or unreachable.

set -uo pipefail
cd "$(dirname "$0")/.."

# consoles.js is a browser IIFE; load it with a stub window and print one
# "<console-id> <archive-item-id>" pair per line.
targets=$(node -e '
const fs = require("fs");
const stub = { location: { pathname: "/emulator/", search: "", hash: "" } };
new Function("window", fs.readFileSync("emulator/consoles.js", "utf8"))(stub);
const itemId = (url) => {
  const m = String(url).match(/archive\.org\/download\/([^/]+)/);
  return m ? m[1] : null;
};
const seen = new Set();
for (const cfg of Object.values(stub.EMULATOR_CONSOLES)) {
  const urls = [].concat(cfg.iaBaseUrl || [], cfg.biosIaBaseUrl || []);
  for (const url of urls) {
    const id = itemId(url);
    if (!id) continue;
    const key = cfg.id + " " + id;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(key);
  }
}
')

if [ -z "$targets" ]; then
  echo "No Internet Archive items found in emulator/consoles.js" >&2
  exit 1
fi

failed=0

while read -r console_id item_id; do
  [ -z "$item_id" ] && continue
  body=$(curl -sS --max-time 30 "https://archive.org/metadata/$item_id" 2>/dev/null)

  verdict=$(printf '%s' "$body" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let meta;
  try {
    meta = JSON.parse(raw || "{}");
  } catch {
    return console.log("FAIL unparseable metadata response");
  }
  if (meta.is_dark) return console.log("FAIL item is dark (taken down)");
  const files = Array.isArray(meta.files) ? meta.files : [];
  if (files.length === 0) return console.log("FAIL no files (missing, or IA busy)");
  console.log("OK " + files.length + " files");
});
')

  status=${verdict%% *}
  detail=${verdict#* }

  if [ "$status" = "OK" ]; then
    printf '  ok   %-10s %-45s %s\n' "$console_id" "$item_id" "$detail"
  else
    printf '  FAIL %-10s %-45s %s\n' "$console_id" "$item_id" "$detail" >&2
    failed=1
  fi
done <<< "$targets"

if [ "$failed" -ne 0 ]; then
  echo >&2
  echo "One or more Archive items are unusable. Find a live replacement with:" >&2
  echo "  curl -s 'https://archive.org/advancedsearch.php?q=<system>+AND+mediatype%3Asoftware&fl%5B%5D=identifier&fl%5B%5D=files_count&sort%5B%5D=files_count+desc&rows=20&output=json'" >&2
  echo "Prefer an item with flat, per-game files (no nested directories)." >&2
  exit 1
fi

echo "All Internet Archive items are live."
