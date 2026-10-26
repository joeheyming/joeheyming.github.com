#!/usr/bin/env node
// Score Paint against PhotoCraft from scripts/ralph/parity.json.
//
//   node scripts/ralph/parity-score.mjs           # totals + per-menu table
//   node scripts/ralph/parity-score.mjs --gaps    # also list every in-scope item not done
//
// The headline is weighted: menus 60%, tools 40%. Only in-scope items count.
import { readFileSync } from 'node:fs';

const WEIGHTS = { menu: 0.6, tool: 0.4 };
const { items } = JSON.parse(readFileSync(new URL('./parity.json', import.meta.url), 'utf8'));
const inScope = items.filter((e) => e.scope === 'in');

function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}

const byArea = {};
for (const e of inScope) {
  const a = (byArea[e.area] ||= { total: 0, done: 0, impl: 0 });
  a.total++;
  if (e.done) a.done++;
  if (e.impl) a.impl++;
}

let weighted = 0;
let weightedImpl = 0;
for (const [area, w] of Object.entries(WEIGHTS)) {
  const a = byArea[area];
  if (!a) continue;
  weighted += w * (a.done / a.total);
  weightedImpl += w * (a.impl / a.total);
}

console.log(`Paint vs PhotoCraft (browser scope): ${pct(weighted, 1)}% done`);
console.log(`  counting behavior reached elsewhere: ${pct(weightedImpl, 1)}%`);
for (const [area, a] of Object.entries(byArea)) {
  console.log(`  ${area}: ${a.done}/${a.total} done (${pct(a.done, a.total)}%), ${a.impl} impl`);
}

const groups = {};
for (const e of inScope.filter((x) => x.area === 'menu')) {
  const top = e.path.split(' > ')[0];
  const g = (groups[top] ||= { total: 0, done: 0 });
  g.total++;
  if (e.done) g.done++;
}
console.log('\nMenus:');
for (const [top, g] of Object.entries(groups)) {
  console.log(
    `  ${top.padEnd(7)} ${String(g.done).padStart(3)}/${g.total} (${pct(g.done, g.total)}%)`
  );
}

if (process.argv.includes('--gaps')) {
  console.log('\nOpen in-scope items:');
  for (const e of inScope.filter((x) => !x.done)) {
    console.log(`  ${e.impl ? '[impl] ' : ''}${e.path} > ${e.label}  (${e.id})`);
  }
}
