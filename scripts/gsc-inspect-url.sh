#!/usr/bin/env bash
# Inspect one URL in Google Search Console and optionally request indexing.
# Usage: ./scripts/gsc-inspect-url.sh <url> [request|inspect]
# Requires an open playwright-cli session: playwright-cli -s=gsc ...
set -u
URL="$1"
DO_REQUEST="${2:-request}"

CODE=$(cat <<'JS'
async page => {
  const TARGET_URL = __TARGET_URL__;
  const DO_REQUEST = __DO_REQUEST__;

  // Clear any prior inspection result. Without this hop, the previous URL's
  // "URL is on Google" / "URL is not on Google" text lingers on screen while
  // GSC fetches the new verdict, and waitForFunction below would return that
  // stale text as the new URL's verdict.
  const resourceMatch = page.url().match(/resource_id=[^&#]+/);
  if (resourceMatch) {
    await page.goto('https://search.google.com/search-console?' + resourceMatch[0]);
    await page
      .waitForFunction(
        () => !/URL is (not )?on Google/.test(document.body.innerText || ''),
        null,
        { timeout: 10000 }
      )
      .catch(() => {});
  }

  const bar = page.getByRole('combobox', { name: /Inspect any URL/i }).first();
  await bar.waitFor({ state: 'visible', timeout: 30000 });
  const beforeUrl = page.url();
  await bar.click();
  await bar.fill(TARGET_URL);
  await bar.press('Enter');

  await page
    .waitForURL(
      u => /\/search-console\/inspect/.test(u.toString()) && u.toString() !== beforeUrl,
      { timeout: 30000 }
    )
    .catch(() => {});

  const verdict = await page
    .waitForFunction(
      () => {
        const t = document.body.innerText || '';
        if (/URL is not on Google/.test(t)) return 'not-on-google';
        if (/URL is on Google/.test(t)) return 'indexed';
        return null;
      },
      null,
      { timeout: 60000 }
    )
    .then(h => h.jsonValue())
    .catch(() => 'unknown');

  if (verdict !== 'not-on-google') return verdict;
  if (!DO_REQUEST) return 'not-on-google';

  await page.evaluate(() => {
    document.querySelectorAll('trans-layer').forEach(el => {
      el.style.pointerEvents = 'none';
      el.querySelectorAll('*').forEach(c => (c.style.pointerEvents = 'none'));
    });
  });

  const testBtn = page.getByRole('button', { name: /test live url/i }).first();
  await testBtn.waitFor({ state: 'visible', timeout: 15000 });
  await testBtn.scrollIntoViewIfNeeded().catch(() => {});
  await testBtn.click({ force: true });

  const liveResult = await page
    .waitForFunction(
      () => {
        const t = document.body.innerText || '';
        if (/URL is available to Google/i.test(t)) return 'live-ok';
        if (/URL is not available to Google|live test failed|cannot be indexed/i.test(t)) return 'live-fail';
        return null;
      },
      null,
      { timeout: 120000 }
    )
    .then(h => h.jsonValue())
    .catch(() => 'live-unknown');

  if (liveResult === 'live-fail') return 'live-fail';

  const reqBtn = page.getByRole('button', { name: /request indexing/i }).first();
  await reqBtn.waitFor({ state: 'visible', timeout: 15000 });
  await reqBtn.scrollIntoViewIfNeeded().catch(() => {});
  await reqBtn.click({ force: true });

  const outcome = await page
    .waitForFunction(
      () => {
        const t = document.body.innerText || '';
        if (/Indexing requested/.test(t)) return 'requested';
        if (/quota exceeded|over the daily quota|reached the daily limit/i.test(t)) return 'quota';
        if (/URL will not be indexed|cannot be indexed|live test failed/i.test(t)) return 'live-fail';
        return null;
      },
      null,
      { timeout: 120000 }
    )
    .then(h => h.jsonValue())
    .catch(() => 'unknown');

  const dismiss = page.getByRole('button', { name: /^dismiss$|^got it$|^close$/i }).first();
  await dismiss.click({ timeout: 5000 }).catch(() => {});

  return outcome;
}
JS
)

DO_REQUEST_BOOL=$([ "$DO_REQUEST" = "request" ] && echo true || echo false)
URL_JSON=$(printf '%s' "$URL" | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>process.stdout.write(JSON.stringify(s)))')

CODE="${CODE//__TARGET_URL__/$URL_JSON}"
CODE="${CODE//__DO_REQUEST__/$DO_REQUEST_BOOL}"

playwright-cli -s=gsc run-code "$CODE" --raw 2>&1 | grep -oE '^(indexed|not-on-google|requested|quota|live-fail|live-ok|live-unknown|unknown)$|"?(indexed|not-on-google|requested|quota|live-fail|live-ok|live-unknown|unknown)"?$' | tr -d '"' | tail -1
