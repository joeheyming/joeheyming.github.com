#!/usr/bin/env python3
"""Fetch verified trivia from Open Trivia DB into trivia/opentdb-import.md.

OpenTDB license: CC BY-SA 4.0 — https://opentdb.com/
Rate limit: ~1 request / 5 seconds per IP. Max 50 questions per call.
Uses a session token to avoid duplicates across pages.

Usage:
  python3 trivia/fetch-opentdb.py
  python3 trivia/fetch-opentdb.py --max-total 1200
  python3 trivia/fetch-opentdb.py --amount-scale 0.5
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'opentdb-import.md'
SLEEP_S = 5.2
BATCH = 50

# Evergreen + common trivia categories (OpenTDB ids).
CATEGORIES = [
    (9, 'general'),
    (17, 'science'),
    (22, 'geography'),
    (23, 'history'),
    (18, 'computers'),
    (19, 'math'),
    (27, 'animals'),
    (25, 'art'),
    (20, 'mythology'),
    (21, 'sports'),
    (28, 'vehicles'),
    (10, 'books'),
    (11, 'film'),
    (12, 'music'),
    (14, 'television'),
    (15, 'videogames'),
    (16, 'boardgames'),
    (24, 'politics'),
    (26, 'celebrities'),
]


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'heyming-trivia-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def request_token() -> str:
    data = http_json('https://opentdb.com/api_token.php?command=request')
    if data.get('response_code') != 0 or not data.get('token'):
        raise RuntimeError(f'token request failed: {data}')
    return str(data['token'])


def fetch_batch(
    amount: int, category: int, qtype: str, token: str
) -> tuple[int, list[dict]]:
    params: dict[str, str | int] = {
        'amount': amount,
        'encode': 'url3986',
        'type': qtype,
        'category': category,
        'token': token,
    }
    url = 'https://opentdb.com/api.php?' + urllib.parse.urlencode(params)
    data = http_json(url)
    code = int(data.get('response_code', -1))
    results: list[dict] = []
    for row in data.get('results') or []:
        results.append(
            {
                'category_raw': urllib.parse.unquote_plus(row['category']).strip(),
                'type': row['type'],
                'difficulty': row['difficulty'],
                'question': urllib.parse.unquote_plus(row['question']).strip(),
                'correct': urllib.parse.unquote_plus(row['correct_answer']).strip(),
                'incorrect': [
                    urllib.parse.unquote_plus(x).strip() for x in row['incorrect_answers']
                ],
            }
        )
    return code, results


def block_for(slug: str, index: int, q: dict) -> str:
    qid = f'opentdb-{slug}-{index:03d}'
    fmt = 'multi' if q['type'] == 'multiple' else 'truefalse'
    choices = [q['correct'], *q['incorrect']]
    rng = random.Random(hashlib.md5(q['question'].encode()).hexdigest())
    rng.shuffle(choices)
    lines = [
        f'### {qid}',
        'mode: fact',
        f'format: {fmt}',
        f'category: {slug}',
        f'difficulty: {q["difficulty"]}',
        'weight: 1',
        f'prompt: {q["question"]}',
    ]
    for lab, ch in zip('abcd', choices[:4]):
        if ch:
            lines.append(f'choice_{lab}: {ch}')
    lines += [
        f'correct: {q["correct"]}',
        f'tags: opentdb, {slug}',
        'source: opentdb',
        'license: CC BY-SA 4.0',
        'attribution: Open Trivia DB (https://opentdb.com/) — CC BY-SA 4.0',
        f'notes: OTDB category: {q["category_raw"]}',
        'active: true',
        '',
    ]
    return '\n'.join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--max-total',
        type=int,
        default=1500,
        help='Stop after this many unique questions (default 1500)',
    )
    parser.add_argument(
        '--max-per-category',
        type=int,
        default=120,
        help='Soft cap per category across types (default 120)',
    )
    parser.add_argument(
        '--amount-scale',
        type=float,
        default=1.0,
        help='Scale max-per-category (default 1.0)',
    )
    args = parser.parse_args()

    per_cat = max(10, int(round(args.max_per_category * args.amount_scale)))
    max_total = max(50, int(round(args.max_total * args.amount_scale)))

    print(f'Requesting session token…')
    token = request_token()
    time.sleep(SLEEP_S)

    seen: set[str] = set()
    unique: list[tuple[str, dict]] = []
    per_slug: dict[str, int] = {}

    for cat_id, slug in CATEGORIES:
        if len(unique) >= max_total:
            break
        for qtype in ('multiple', 'boolean'):
            if len(unique) >= max_total:
                break
            if per_slug.get(slug, 0) >= per_cat:
                break
            empty_streak = 0
            while len(unique) < max_total and per_slug.get(slug, 0) < per_cat:
                remaining = min(BATCH, per_cat - per_slug.get(slug, 0), max_total - len(unique))
                if remaining <= 0:
                    break
                try:
                    code, batch = fetch_batch(remaining, cat_id, qtype, token)
                except urllib.error.HTTPError as err:
                    print(f'HTTP {err.code} cat={cat_id} ({slug}) type={qtype}; backing off')
                    time.sleep(SLEEP_S * 2)
                    continue
                except Exception as err:
                    print(f'error cat={cat_id} ({slug}) type={qtype}: {err}')
                    time.sleep(SLEEP_S)
                    break

                added = 0
                for q in batch:
                    key = q['question'].strip().lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    unique.append((slug, q))
                    per_slug[slug] = per_slug.get(slug, 0) + 1
                    added += 1

                print(
                    f'ok cat={cat_id} ({slug}) type={qtype} code={code} '
                    f'batch={len(batch)} new={added} total={len(unique)}'
                )

                # 1 = not enough results, 4 = token exhausted for this query
                if code in (1, 4) or not batch:
                    empty_streak += 1
                    if empty_streak >= 1:
                        break
                else:
                    empty_streak = 0

                time.sleep(SLEEP_S)

    blocks = [block_for(slug, i, q) for i, (slug, q) in enumerate(unique, 1)]
    header = """# OpenTDB import (generated)

Do not hand-edit. Re-run:

```bash
python3 trivia/fetch-opentdb.py
```

Source: [Open Trivia DB](https://opentdb.com/) API.
License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Rate limit: about one request every five seconds.

---

"""
    OUT.write_text(header + '\n'.join(blocks), encoding='utf-8')
    print(f'Wrote {OUT} ({len(blocks)} questions)')
    for slug, n in sorted(per_slug.items(), key=lambda x: (-x[1], x[0])):
        print(f'  {slug}: {n}')


if __name__ == '__main__':
    main()
