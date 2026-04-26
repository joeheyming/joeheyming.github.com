# Ubiquitous Language

Vocabulary for [joeheyming.github.io](https://joeheyming.github.io/) — the public personal site and interactive project hub hosted on GitHub Pages.

## Site and identity

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Public site** | The published GitHub Pages property served at `joeheyming.github.io` | Repo folder name, localhost |
| **Author** | Joe Heyming as the named person represented in copy, schema, and OAuth consent | User, account (in policy sense) |
| **Canonical URL** | The preferred public address for indexing and sharing (`https://joeheyming.github.io/…`) | Relative path only, duplicate hosts |

## Portfolio narrative

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Role** | The professional title used on the site (UI Engineer) | Job, position (unless matching résumé) |
| **Primary employer** | Roblox as the current workplace called out in hero and structured data | Company (vague), “the platform” alone |
| **Trust & Safety** | The product area at Roblox emphasized in highlights and fun facts | T&S abbreviation in user-facing hero (optional in dev copy) |
| **Work history** | Past and present employers shown in “Places I've Worked” | Resume, CV (as section name) |

## Projects and catalog

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Application** | A registered entry in the site catalog with id, path, category, and optional desktop metadata | Microservice, module |
| **Side project** | Demos and tools shipped under the personal site, framed as non-work experiments | Production service, portfolio piece alone |
| **Featured project** | A project promoted in the homepage grid with deep links and engagement tracking | Spotlight (unless you rename the section) |
| **Interactive project** | Copy framing for games, tools, and experiments the visitor can run in the browser | Web app (unless distinguishing from static pages) |
| **Experiment** | A small or playful build (often a game or one-off demo) | Proof of concept, spike |

## HEYMING-OS shell

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **HEYMING-OS** | The in-browser “desktop OS” experience that hosts Applications in windows | OS simulation (unless explaining to newcomers), “the framework” |
| **Desktop** | The main surface where Application windows and icons appear | Viewport, canvas |
| **Taskbar** | The strip that shows running Applications and quick access | Dock (unless matching UI label) |
| **Application window** | A framed instance of an Application running inside HEYMING-OS | Tab, panel |
| **System application** | An Application bundled with the shell (e.g. Notepad, Surf) with `system: true` in config | Built-in (unless user-facing label says otherwise) |
| **Application registry** | The authoritative list and metadata for all Applications (`appRegistry`) | Manifest, route table |
| **Desktop icon** | A launch affordance on the Desktop for an Application that opts in | Shortcut (unless matching copy) |

## Application taxonomy

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Category** | The primary type label on an Application: game, utility, or entertainment | Genre (use **tags** for finer labels) |
| **Tag** | Searchable labels attached to Applications for filtering and discovery | Keyword stuffing, hashtag |

## Trust, policies, and crawlers

| Term | Definition | Aliases to avoid |
| ---- | ---------- | ---------------- |
| **Privacy Policy** | The standalone page describing data practices for site features | Privacy doc |
| **Terms of Service** | The standalone page describing acceptable use and legal terms | TOS file |
| **Crawler-visible policy strip** | The minimal HTML nav that exposes policy links without relying on the full JS/CSS stack | Footer (ambiguous with marketing footer) |

## Relationships

- The **Public site** hosts many **Side projects**, each reachable as an **Application** with its own path.
- **HEYMING-OS** presents **Applications** on a **Desktop** and in **Application windows**; the **Application registry** is the single source of truth for what can launch.
- A **System application** is still an **Application**, but is part of the shell rather than an optional demo.
- **Featured projects** are a curated subset of **Side projects**; not every **Application** is featured on the landing grid.
- The **Author**’s **Role** and **Primary employer** appear in narrative copy and structured data alongside **Work history**.

## Example dialogue

> **Dev:** “Should this new demo be an **Application** in the registry or just a static page?”

> **Domain expert:** “If it should open inside **HEYMING-OS** from the hamburger menu, it must be an **Application** with a path and category. A static article with no shell integration stays a normal page, not part of the **Application registry**.”

> **Dev:** “The marketing section calls it an **interactive project** — same thing?”

> **Domain expert:** “**Interactive project** is how we talk to visitors on the homepage. **Application** is how the shell and config know it. One demo can be both.”

> **Dev:** “Do we mark it **system**?”

> **Domain expert:** “Only if it is a **system application** like Notepad or Surf — something the **Desktop** expects always to exist. Games and one-offs stay regular **Applications**.”

## Flagged ambiguities

- **Application** vs **app** vs **project**: The hamburger panel title says “Applications” while the filter placeholder says “Filter apps…” and the hero speaks of “projects.” **Recommendation:** Use **Application** in code and registry docs; use **Side project** or **interactive project** in marketing copy; treat “app” as informal UI shorthand only.
- **GitHub Pages site** vs **repository name**: The live host is `joeheyming.github.io`; the clone may be `joeheyming.github.com`. **Recommendation:** Say **Public site** or **canonical URL** when discussing behavior for visitors or SEO.
- **Game** as **category** vs “game” in casual copy: Registry **category** is a controlled value; prose may call something a “game” without matching `category: 'game'`. **Recommendation:** Align registry **category** with how you want filtering to work, not only marketing adjectives.
