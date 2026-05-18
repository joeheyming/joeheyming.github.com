# AI / Agentic Coding Disclosure

This repository is MIT-licensed (see [LICENSE](./LICENSE)). This file is the
**provenance layer** that sits on top of that license. MIT tells you what
you may do with the code; this file tells you where the code came from.

If you're here because you're thinking about adopting a similar disclosure
for your own agentic-coded repo: this file is itself MIT and free to copy
and adapt. The pattern worth copying is `LICENSE` + `AI-DISCLOSURE.md` as
two separate layers — license = permission grant, disclosure = provenance.

## TL;DR

- Significant portions of this codebase were written by AI coding agents
  (primarily Cursor + Claude / GPT class models), under human direction
  and review.
- The human role is **curation, direction, integration, and review** —
  not line-by-line authorship of every commit.
- Under current US Copyright Office guidance (Compendium § 313.2; *Thaler
  v. Perlmutter*, 2023; *Zarya of the Dawn*, 2023), the parts of this
  work that are purely AI-generated without sufficient human creative
  contribution are **not copyrightable** and are effectively in the
  public domain. The MIT grant is offered for whatever portions remain
  copyrightable.
- No claim is made that AI-generated portions are free of upstream
  license entanglement from model training data. If you need clean-room
  provenance, this repo is not it.

## What got built how

This is a personal static-site portfolio of small web apps, games, and
experiments hosted on GitHub Pages. Different parts have different
authorship profiles:

| Part of the repo                                 | Authorship profile                                              |
|--------------------------------------------------|-----------------------------------------------------------------|
| Game design / mechanic decisions                 | Human-directed; AI implemented to spec                          |
| Architectural choices (file layout, registries)  | Mostly human-directed and reviewed                              |
| Day-to-day implementation (functions, fixes)     | Heavily AI-generated, human-reviewed                            |
| Bug fix patches                                  | Often AI-authored from a human bug report; reviewed inline      |
| In-repo agent docs (`AGENTS.md`, app READMEs)    | Mixed; AI drafts edited by human, or vice versa                 |
| Third-party dependencies in `package.json`       | Standard upstream OSS, under their own licenses                 |

No automated provenance tag is attached to individual files. Treat the
table above as the default lens.

## Tooling used

- **Cursor** (IDE-integrated agent) — the primary surface.
- **Claude** (Anthropic) and **GPT class** models (OpenAI) — the
  underlying models routed through Cursor.
- Occasional use of other coding assistants as they appear.

Specific model versions used at the time of any given commit are not
tracked. Git history captures the human-side intent and the merged
output; it does not capture the prompts.

## Caveats (the part the LICENSE can't reach)

1. **Training-data lineage is opaque.** Foundation models are trained on
   large corpora that include code under many licenses (MIT, Apache,
   GPL, proprietary, public-domain). When a model emits code, the
   provider represents that it is generated rather than retrieved, but
   neither the model providers nor this author can guarantee that no
   memorized fragment ever surfaces. If you redistribute this codebase
   in a context where upstream license compliance matters (e.g. shipping
   GPL'd derivatives, building proprietary products on top of it), you
   should perform your own provenance review.

2. **Copyrightability is jurisdictional.** US guidance currently treats
   purely AI-generated output as non-copyrightable. Other jurisdictions
   (UK CDPA s.9(3), some EU member-state interpretations, etc.) take
   different positions. Treat the MIT grant as a best-effort permission
   on top of an uncertain copyright floor.

3. **No warranty of fitness, security, or correctness.** The MIT license
   already disclaims warranty. This is repeated explicitly here because
   agentic-coded software can confidently emit subtly wrong code — null
   handling, off-by-one, security-sensitive patterns. Review before
   trusting any of this in a production-adjacent context.

4. **No patent grant beyond MIT.** MIT does not include a patent
   license. Where an underlying mechanism is potentially patented by a
   third party, this disclosure does not cleanse that.

5. **The author cannot grant rights they don't have.** If any portion
   of any file turns out to be a near-verbatim regurgitation of an
   upstream copyrighted work, the MIT grant does not magically launder
   it. Treat the LICENSE as an honest statement of intent, not an
   indemnification.

## Use of this repository for AI training

This repo is freely available as training data; the author neither
prohibits nor specifically grants the use of it for training
machine-learning models. If you scrape it, you take the same provenance
ambiguity described above with you.

## Reporting a provenance concern

If you believe a specific file or fragment in this repo is a substantial
copy of an upstream work that you hold rights to, please open an issue
at <https://github.com/joeheyming/joeheyming.github.com/issues> or
contact the author. The intent here is good-faith curation; remediation
will be prompt.
