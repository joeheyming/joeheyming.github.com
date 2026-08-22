#!/usr/bin/env python3
"""Parse trivia markdown question banks into Questions-tab CSV.

Reads:
  trivia/questions.md
  trivia/opentdb-import.md

Writes:
  trivia/questions.csv

Usage:
  python3 trivia/md-to-csv.py
  python3 trivia/md-to-csv.py -o /tmp/questions.csv
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCES = [ROOT / 'questions.md', ROOT / 'opentdb-import.md']
DEFAULT_OUT = ROOT / 'questions.csv'

HEADERS = [
    'id',
    'mode',
    'format',
    'prompt',
    'choice_a',
    'choice_b',
    'choice_c',
    'choice_d',
    'correct',
    'estimate_answer',
    'estimate_unit',
    'estimate_tolerance',
    'category',
    'tags',
    'difficulty',
    'weight',
    'source',
    'license',
    'attribution',
    'notes',
    'active',
]

SKIP_IDS = {'<id>'}


def parse_blocks(text: str) -> list[dict[str, str]]:
    parts = re.split(r'(?m)^### ', text)
    rows: list[dict[str, str]] = []
    for part in parts[1:]:
        lines = part.splitlines()
        if not lines:
            continue
        qid = lines[0].strip()
        if not qid or qid in SKIP_IDS:
            continue
        fields: dict[str, str] = {'id': qid}
        for line in lines[1:]:
            if not line.strip():
                # Stop at blank line only if we already have a mode (end of block)
                if 'mode' in fields:
                    break
                continue
            if line.startswith('#') or line.startswith('```'):
                break
            if ':' not in line:
                continue
            key, _, val = line.partition(':')
            key = key.strip()
            val = val.strip()
            if key:
                fields[key] = val
        if 'mode' not in fields or 'prompt' not in fields:
            continue
        rows.append(fields)
    return rows


def normalize(row: dict[str, str]) -> dict[str, str]:
    out = {h: row.get(h, '') for h in HEADERS}
    out['id'] = row.get('id', '').strip()
    if not out.get('weight'):
        out['weight'] = '1'
    active = str(out.get('active', 'true')).strip().lower()
    out['active'] = 'true' if active in ('true', '1', 'yes', 'y') else 'false'
    return out


def validate_row(row: dict[str, str]) -> str | None:
    """Return a warning message if the row looks broken."""
    if row['active'] != 'true':
        return None
    mode = row['mode'].strip().lower()
    fmt = row['format'].strip().lower()
    if mode == 'estimate' or fmt == 'number':
        return None
    choices = [row[c].strip() for c in ('choice_a', 'choice_b', 'choice_c', 'choice_d') if row[c].strip()]
    if fmt in ('truefalse', 'boolean'):
        return None
    if len(choices) < 2:
        return f'{row["id"]}: need ≥2 choices (got {len(choices)})'
    if mode == 'fact' and row['correct'].strip() and row['correct'].strip() not in choices:
        # Allow True/False match after normalize later; only warn on clear mismatch for multi.
        if fmt == 'multi':
            return f'{row["id"]}: correct={row["correct"]!r} not in choices'
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '-o',
        '--output',
        type=Path,
        default=DEFAULT_OUT,
        help=f'Output CSV path (default {DEFAULT_OUT})',
    )
    parser.add_argument(
        'sources',
        nargs='*',
        type=Path,
        help='Markdown sources (default: questions.md + opentdb-import.md)',
    )
    args = parser.parse_args()
    sources = args.sources or DEFAULT_SOURCES

    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    warnings = 0
    for path in sources:
        if not path.is_file():
            print(f'skip missing {path}')
            continue
        for raw in parse_blocks(path.read_text(encoding='utf-8')):
            row = normalize(raw)
            qid = row['id']
            if qid in seen:
                print(f'duplicate id skipped: {qid}')
                continue
            seen.add(qid)
            warn = validate_row(row)
            if warn:
                print(f'warn: {warn}')
                warnings += 1
            rows.append(row)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(rows)

    active = sum(1 for r in rows if r['active'] == 'true')
    print(f'Wrote {args.output} ({len(rows)} questions, {active} active, {warnings} warnings)')


if __name__ == '__main__':
    main()
