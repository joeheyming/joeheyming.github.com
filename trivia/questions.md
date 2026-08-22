# Trivia question bank

Staging files for a Google Sheet that will drive the stranger/Jackbox-style app.

| File | Contents | How it gets filled |
| --- | --- | --- |
| `questions.md` (this file) | Opinion + **cited** estimates | Hand-written; estimates need a source URL |
| `opentdb-import.md` | Fact trivia | **Only** via `python3 trivia/fetch-opentdb.py` |
| Sheet `Questions` tab | Runtime | `python3 trivia/md-to-csv.py` → import `questions.csv` (see SETUP.local.md) |

## Anti-hallucination rules

1. **Fact** rows must come from `opentdb-import.md` (Open Trivia DB API) or another dump with per-row `source` + `license` + `attribution`. Do not invent fact Q&A in chat.
2. **Estimate** rows need a real citation in `attribution` (NASA, NIST, national survey, textbook BioNumber, etc.). If you cannot cite it, set `active: false` or delete it.
3. **Opinion** rows are preference prompts — no correct answer. Original wording is fine.
4. Prefer re-fetching / re-verifying over “I think this is right.”
5. OpenTDB is user-contributed and can still be wrong or stale (e.g. “fastest car”). Treat imports as a starting bank; deactivate bad rows when spotted.

## Pipeline

1. Expand opinions here; expand facts with `fetch-opentdb.py --max-total 1500` (rate-limited ~5s/request).
2. Convert markdown blocks → Sheet CSV: `python3 trivia/md-to-csv.py`.
3. Import `questions.csv` into the Sheet **Questions** tab; Apps Script rotates **Current** every 30 minutes (see SETUP.local.md).
4. App reads **Round** / **Current** / **Tallies** via gviz.

## Sheet columns (target schema)

| column | type | notes |
| --- | --- | --- |
| `id` | string | Stable slug; never reuse |
| `mode` | enum | `opinion` \| `estimate` \| `fact` |
| `format` | enum | `binary` \| `multi` \| `truefalse` \| `number` |
| `prompt` | string | Shown to players |
| `choice_a`…`choice_d` | string | Empty when unused |
| `correct` | string | Fact only; must match a choice (or `True`/`False`) |
| `estimate_answer` | number | Estimate only; ground truth |
| `estimate_unit` | string | e.g. `km`, `year` |
| `estimate_tolerance` | number | Absolute “close enough” band |
| `category` | string | |
| `tags` | string | Comma-separated |
| `difficulty` | enum | `easy` \| `medium` \| `hard` |
| `weight` | number | Default `1` |
| `source` | string | `original` \| `opentdb` \| … |
| `license` | string | |
| `attribution` | string | **Required** for fact + estimate |
| `notes` | string | Editor-only |
| `active` | bool | |

## Licensing

- Opinion / original estimates: `license: CC0` (or site default) plus citation URL for the number.
- OpenTDB facts: **CC BY-SA 4.0** — keep attribution on every row; share-alike applies to that subset.

## Block format

```
### <id>
mode: …
format: …
…
attribution: <citation or OTDB credit>
active: true
```

---

## Opinion — binary / multi

Original preference prompts (no factual claim). Safe to hand-edit.


### opinion-food-001
mode: opinion
format: binary
category: food
difficulty: easy
weight: 1
prompt: Pineapple on pizza?
choice_a: Yes, obviously
choice_b: Absolutely not
tags: food, debate
source: original
license: CC0
attribution:
notes: Classic split; great first-round demo
active: true

### opinion-food-002
mode: opinion
format: binary
category: food
difficulty: easy
weight: 1
prompt: Is a hot dog a sandwich?
choice_a: Yes
choice_b: No
tags: food, semantics
source: original
license: CC0
attribution:
notes:
active: true

### opinion-food-003
mode: opinion
format: binary
category: food
difficulty: easy
weight: 1
prompt: Cereal — milk first or cereal first?
choice_a: Milk first
choice_b: Cereal first
tags: food, morning
source: original
license: CC0
attribution:
notes:
active: true

### opinion-food-004
mode: opinion
format: binary
category: food
difficulty: easy
weight: 1
prompt: Fries: ketchup or no ketchup?
choice_a: Ketchup
choice_b: No ketchup
tags: food
source: original
license: CC0
attribution:
notes:
active: true

### opinion-food-005
mode: opinion
format: binary
category: food
difficulty: easy
weight: 1
prompt: Sweet or savory breakfast?
choice_a: Sweet
choice_b: Savory
tags: food, morning
source: original
license: CC0
attribution:
notes:
active: true

### opinion-life-001
mode: opinion
format: binary
category: lifestyle
difficulty: easy
weight: 1
prompt: Morning person or night owl?
choice_a: Morning
choice_b: Night
tags: lifestyle
source: original
license: CC0
attribution:
notes:
active: true

### opinion-life-002
mode: opinion
format: binary
category: lifestyle
difficulty: easy
weight: 1
prompt: Beach vacation or mountain vacation?
choice_a: Beach
choice_b: Mountains
tags: travel
source: original
license: CC0
attribution:
notes:
active: true

### opinion-life-003
mode: opinion
format: binary
category: lifestyle
difficulty: easy
weight: 1
prompt: Cats or dogs?
choice_a: Cats
choice_b: Dogs
tags: animals
source: original
license: CC0
attribution:
notes:
active: true

### opinion-life-004
mode: opinion
format: binary
category: lifestyle
difficulty: medium
weight: 1
prompt: Always early or always exactly on time?
choice_a: Always early
choice_b: Exactly on time
tags: lifestyle, habits
source: original
license: CC0
attribution:
notes: Avoid “always late” as a soft flex that dominates
active: true

### opinion-life-005
mode: opinion
format: binary
category: lifestyle
difficulty: easy
weight: 1
prompt: Text first or call first?
choice_a: Text
choice_b: Call
tags: communication
source: original
license: CC0
attribution:
notes:
active: true

### opinion-absurd-001
mode: opinion
format: binary
category: absurd
difficulty: easy
weight: 1
prompt: Fight 100 duck-sized horses or 1 horse-sized duck?
choice_a: 100 duck-sized horses
choice_b: 1 horse-sized duck
tags: absurd, classic
source: original
license: CC0
attribution:
notes: Internet-classic dilemma; original wording
active: true

### opinion-absurd-002
mode: opinion
format: binary
category: absurd
difficulty: easy
weight: 1
prompt: Invisible or able to fly — but only 1 meter off the ground?
choice_a: Invisible
choice_b: Low flight
tags: absurd, powers
source: original
license: CC0
attribution:
notes:
active: true

### opinion-absurd-003
mode: opinion
format: binary
category: absurd
difficulty: easy
weight: 1
prompt: Unlimited bacon or unlimited free plane tickets?
choice_a: Bacon
choice_b: Plane tickets
tags: absurd, food, travel
source: original
license: CC0
attribution:
notes:
active: true

### opinion-tech-001
mode: opinion
format: binary
category: tech
difficulty: easy
weight: 1
prompt: Tabs or spaces?
choice_a: Tabs
choice_b: Spaces
tags: tech, programming
source: original
license: CC0
attribution:
notes: Site audience skews nerdy
active: true

### opinion-tech-002
mode: opinion
format: binary
category: tech
difficulty: easy
weight: 1
prompt: Dark mode or light mode?
choice_a: Dark
choice_b: Light
tags: tech, ui
source: original
license: CC0
attribution:
notes:
active: true

### opinion-tech-003
mode: opinion
format: binary
category: tech
difficulty: easy
weight: 1
prompt: Desktop or laptop as daily driver?
choice_a: Desktop
choice_b: Laptop
tags: tech
source: original
license: CC0
attribution:
notes:
active: true

### opinion-media-001
mode: opinion
format: binary
category: media
difficulty: easy
weight: 1
prompt: Books or movies for the same story?
choice_a: Books
choice_b: Movies
tags: media
source: original
license: CC0
attribution:
notes:
active: true

### opinion-media-002
mode: opinion
format: binary
category: media
difficulty: easy
weight: 1
prompt: Sequel or remake?
choice_a: Sequel
choice_b: Remake
tags: media
source: original
license: CC0
attribution:
notes:
active: true

### opinion-media-003
mode: opinion
format: binary
category: media
difficulty: easy
weight: 1
prompt: Listen to the same album forever or a random song every time?
choice_a: Same album
choice_b: Random forever
tags: music
source: original
license: CC0
attribution:
notes:
active: true

### opinion-deep-001
mode: opinion
format: binary
category: values
difficulty: medium
weight: 1
prompt: More time or more money?
choice_a: Time
choice_b: Money
tags: values
source: original
license: CC0
attribution:
notes:
active: true

### opinion-deep-002
mode: opinion
format: binary
category: values
difficulty: medium
weight: 1
prompt: Know a little about everything, or everything about one thing?
choice_a: Little about everything
choice_b: Everything about one thing
tags: values, learning
source: original
license: CC0
attribution:
notes:
active: true

### opinion-deep-003
mode: opinion
format: binary
category: values
difficulty: medium
weight: 1
prompt: Surprise party for you, or plan your own celebration?
choice_a: Surprise me
choice_b: Let me plan it
tags: values, social
source: original
license: CC0
attribution:
notes:
active: true

## Opinion — multi (4-way preference)

### opinion-multi-001
mode: opinion
format: multi
category: food
difficulty: easy
weight: 1
prompt: Best comfort food?
choice_a: Pizza
choice_b: Pasta
choice_c: Tacos
choice_d: Soup / stew
tags: food
source: original
license: CC0
attribution:
notes:
active: true

### opinion-multi-002
mode: opinion
format: multi
category: lifestyle
difficulty: easy
weight: 1
prompt: Ideal Saturday?
choice_a: Adventure outdoors
choice_b: Couch + shows
choice_c: Side project / making stuff
choice_d: Friends / social plans
tags: lifestyle
source: original
license: CC0
attribution:
notes:
active: true

### opinion-multi-003
mode: opinion
format: multi
category: media
difficulty: easy
weight: 1
prompt: Decade with the best music?
choice_a: 70s
choice_b: 80s
choice_c: 90s
choice_d: 2000s
tags: music
source: original
license: CC0
attribution:
notes: Skip 2010s/2020s to reduce recency fights; rotate later
active: true

### opinion-multi-004
mode: opinion
format: multi
category: tech
difficulty: easy
weight: 1
prompt: If you could only keep one?
choice_a: Phone
choice_b: Laptop
choice_c: Headphones
choice_d: Coffee maker
tags: tech, lifestyle
source: original
license: CC0
attribution:
notes:
active: true

### opinion-multi-005
mode: opinion
format: multi
category: travel
difficulty: easy
weight: 1
prompt: Dream trip style?
choice_a: Road trip
choice_b: Train across a country
choice_c: Island do-nothing
choice_d: Big city wander
tags: travel
source: original
license: CC0
attribution:
notes:
active: true

---

## Numerical trivia — multiple choice (cited)

Free-typed estimates are awkward for exact figures people don’t memorize. These keep the old `estimate-*` ids / third-slot rotation, but use **four choices** with a cited correct answer.

### estimate-space-001
mode: estimate
format: multi
category: space
difficulty: medium
weight: 1
prompt: About how far is the Moon from Earth on average?
choice_a: About 384,000 km
choice_b: About 150,000 km
choice_c: About 1 million km
choice_d: About 38,000 km
correct: About 384,000 km
tags: space, distance
source: nasa
license: CC0
attribution: NASA Moon Facts — average distance 384,400 km (https://science.nasa.gov/moon/facts/)
notes: Was free-number estimate; converted to MC
active: true

### estimate-space-002
mode: estimate
format: multi
category: space
difficulty: hard
weight: 1
prompt: Roughly how many Earths could fit inside the Sun by volume?
choice_a: About 1.3 million
choice_b: About 100,000
choice_c: About 10 million
choice_d: About 13,000
correct: About 1.3 million
tags: space
source: nasa
license: CC0
attribution: NASA NSSDC Sun Fact Sheet volume ratio Sun/Earth ≈ 1,304,000 (https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)
notes: Was free-number estimate; converted to MC
active: true

### estimate-geo-001
mode: estimate
format: multi
category: geography
difficulty: medium
weight: 1
prompt: About how long is Earth's equatorial circumference?
choice_a: About 40,000 km
choice_b: About 25,000 km
choice_c: About 12,000 km
choice_d: About 100,000 km
correct: About 40,000 km
tags: geography
source: wgs84
license: CC0
attribution: WGS84 equatorial radius 6,378.137 km → 2πR ≈ 40,075 km (NIMA/NGA WGS84)
notes: Was free-number estimate; converted to MC
active: true

### estimate-geo-002
mode: estimate
format: multi
category: geography
difficulty: medium
weight: 1
prompt: What is the official height of Mount Everest (nearest meter)?
choice_a: 8,849 m
choice_b: 8,848 m
choice_c: 8,000 m
choice_d: 9,144 m
correct: 8,849 m
tags: geography
source: nepal-china-2020
license: CC0
attribution: Nepal–China joint announcement 8,848.86 m (2020); round to 8849 (https://www.reuters.com/world/china/mount-everest-is-higher-than-we-thought-say-nepal-china-2020-12-08/)
notes: Was free-number estimate; converted to MC. 8848 is a common older figure — kept as distractor.
active: true

### estimate-science-001
mode: estimate
format: multi
category: science
difficulty: medium
weight: 1
prompt: What is the speed of light in vacuum?
choice_a: About 300,000 km/s
choice_b: About 30,000 km/s
choice_c: About 3 million km/s
choice_d: About 3,000 km/s
correct: About 300,000 km/s
tags: science, physics
source: nist
license: CC0
attribution: NIST — c = 299,792,458 m/s exact → ~299,792 km/s (https://physics.nist.gov/constants)
notes: Was free-number estimate; converted to MC (rounded choice)
active: true

### estimate-science-002
mode: estimate
format: multi
category: science
difficulty: easy
weight: 1
prompt: How many bones are in the standard adult human skeleton count taught in textbooks?
choice_a: 206
choice_b: 270
choice_c: 186
choice_d: 300
correct: 206
tags: science, biology
source: bionumbers
license: CC0
attribution: BioNumbers BNID 102383 cites Steele & Bramblett — 206 adult bones (https://bionumbers.hms.harvard.edu/bionumber.aspx?id=102383)
notes: Was free-number estimate; converted to MC
active: true

### estimate-history-001
mode: estimate
format: multi
category: history
difficulty: medium
weight: 1
prompt: In what year did the Wright brothers make the first powered airplane flight at Kitty Hawk?
choice_a: 1903
choice_b: 1899
choice_c: 1914
choice_d: 1927
correct: 1903
tags: history, aviation
source: smithsonian
license: CC0
attribution: Smithsonian National Air and Space Museum — 1903 Wright Flyer, first flight Dec 17 1903 (https://airandspace.si.edu/collection-objects/1903-wright-flyer/nasm_A19610048000)
notes: Was free-number estimate; converted to MC
active: true

### estimate-history-002
mode: estimate
format: multi
category: history
difficulty: easy
weight: 1
prompt: In what year did the Berlin Wall fall?
choice_a: 1989
choice_b: 1991
choice_c: 1985
choice_d: 1979
correct: 1989
tags: history
source: original-cited
license: CC0
attribution: Widely documented historical date — 9 November 1989 (e.g. Britannica: https://www.britannica.com/topic/Berlin-Wall)
notes: Was free-number estimate; converted to MC
active: true

### estimate-tech-001
mode: estimate
format: multi
category: tech
difficulty: medium
weight: 1
prompt: In what year was the first iPhone announced?
choice_a: 2007
choice_b: 2005
choice_c: 2009
choice_d: 2010
correct: 2007
tags: tech
source: apple
license: CC0
attribution: Apple special event January 9, 2007 — first iPhone announced (contemporary coverage / Apple newsroom archives)
notes: Was free-number estimate; converted to MC
active: true

### estimate-absurd-002
mode: estimate
format: multi
category: absurd
difficulty: medium
weight: 1
prompt: How many end-to-end 6-inch hot dogs fit along 100 yards?
choice_a: 600
choice_b: 100
choice_c: 1,200
choice_d: 360
correct: 600
tags: absurd, math
source: original
license: CC0
attribution: Arithmetic — 100 yards = 3600 inches; 3600 / 6 = 600 (assumption stated in prompt)
notes: Was free-number estimate; converted to MC
active: true

---

## Fact trivia

**Do not paste invented facts here.**

Generated bank (see last fetch): [`opentdb-import.md`](./opentdb-import.md)

Refresh:

```bash
python3 trivia/fetch-opentdb.py --max-total 1500
```

Optional later: importer for [OpenTriviaQA](https://github.com/uberspot/OpenTriviaQA) (also CC BY-SA 4.0) with the same attribution fields.

### Research backlog

- Spot-check OTDB rows that smell stale (records, “fastest”, population) → `active: false`
- Prefer multiple-choice for numerical trivia; free-number estimates only when Fermi-style range guessing is the point
- Site-meta estimates (registry app count) filled from `apps-registry.json` at import time
