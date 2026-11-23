# PROJECT.md: alrightansh.com reference

Working notes for anyone (human or agent) changing this site. Read this first.

## What the site is

- `/`: **the flight**. A scroll-driven three.js flight over a particle terrain with three real-data map stops
  (Neugal watershed, North India sun and wind, Himachal from orbit). This is the site's identity; change it with care.
- `/work/` and its case studies: **reading pages** for recruiters and engineers. Normal document scroll, same type,
  colour and motion as the flight. Added in the Enterprise GIS upgrade (see below).

| Route | Purpose |
|---|---|
| `/` | The flight (unchanged experience; links into the work pages) |
| `/work/` | Overview: positioning, focus areas, experience, skills matrix, contact |
| `/work/utility-network/` | Case study: Smallworld to Esri, ArcGIS Utility Network, network data, PostGIS, FME, Python, Power BI |
| `/work/ai/` | AI meets GIS: MCP server architecture with status labels |
| `/work/earth-observation/` | Research and Earth observation projects, linked to their stops in the flight |

Deep links into the flight: `/#utility-networks`, `/#toolkit`, `/#remote-sensing`, `/#neugal`, `/#sun-and-wind`,
`/#himachal`, `/#himachal-from-orbit`, `/#gispost`, `/#paper-peaks`, `/#makemedizzy` (ids live in `src/scripts/content.js`).

## Stack

- Astro 5 (static output, `trailingSlash: "always"`), three.js 0.170, no UI framework, no CSS framework.
- Fonts: Overused Grotesk 400/500, self-hosted in `public/fonts/`. Code uses the system monospace stack.
- Code highlighting: Astro's built-in `<Code>` (Shiki) with a custom theme; tokens become classes at build time
  (`src/scripts/code-theme.js`) because the CSP forbids inline styles.
- Hosting: Cloudflare Workers static assets (`wrangler.jsonc`). Every push to `main` builds and goes live through
  Workers Builds; other branches get a preview URL. A failed build leaves the live site as it was. Docker (node build,
  nginx-unprivileged) stays for local testing and as a fallback host. See `DEPLOY.md`.
- Headers and redirects exist twice: `public/_headers` and `public/_redirects` for Cloudflare, `security-headers.conf`
  and `nginx.conf` for Docker. Change both sides together.

## Hard constraint: Content Security Policy

`public/_headers` (live) and `security-headers.conf` (Docker) send `script-src 'self'; style-src 'self'`. Therefore:

- No inline `<script>` (except `type="application/ld+json"` data blocks with `is:inline`) and no inline `<style>`.
- No `style="..."` attributes in markup. Set styles from JS through CSSOM (`el.style.x = ...`), which CSP allows.
- `astro.config.mjs` sets `build.inlineStylesheets: "never"` and `vite.build.assetsInlineLimit: 0` so Astro never
  inlines small CSS or JS. Do not remove these.
- After a build, `dist/**/*.html` must contain no `<style` and no `<script>` without `src`, apart from JSON-LD.
  `npm run build` enforces this with `tools/check-csp.mjs` and fails otherwise, which also stops the deploy.

## Layout of the code

```
src/pages/index.astro            flight page (HUD markup + styles)
src/pages/work/*.astro           reading pages
src/layouts/Page.astro           shared head (meta, OG, JSON-LD), chrome, menu, contact outro, ticks
src/components/*.astro           Hero, Contours, Chapter, Flow, NetworkDiagram, Equation, CodeTabs, CodeBlock,
                                 Compare, SkillsMatrix, Status, Figure, ProjectCase, Cta
src/data/site.js                 person, links, nav, status vocabulary
src/data/{flows,skills,ai,projects,code}.js   structured copy for the reading pages
src/styles/base.css              tokens, @font-face, reveal primitives, ticks, page-change bar (both page types)
src/styles/page.css              reading-page styles
src/scripts/main.js              flight orchestration (boot, virtual scroll, stops, deep links)
src/scripts/ui.js                DOM motion primitives, shared by the flight and the reading pages
src/scripts/transition.js        page changes: the accent bar sweeps, the page fades to the background
src/scripts/page.js              reading-page entry
src/scripts/page-reveal.js       reveal on entering the viewport ([data-split], [data-block], [data-items], [data-img])
src/scripts/page-chrome.js       top bar, menu, hero drift, chapter ticks, magnet button, contour draw-in
src/scripts/page-flow.js         pipelines: rail draw-in, pulse, stage HUD, scroll-pinned mode
src/scripts/page-network.js      Utility Network schematic: energise-in, legend isolation, subnetwork trace
src/scripts/page-widgets.js      code tabs, equation highlight
src/scripts/contours.js          build-time contour field (noise + marching squares) for hero backgrounds
src/scripts/code-theme.js        build-time Shiki theme + style-to-class transformer (CSP)
src/scripts/content.js           flight copy (stations, with deep-link ids and links to the work pages)
public/work/                     WebP images for the reading pages (tools/work/build_images.py), versioned -v1
public/og.jpg                    1200 x 630 social image: a still of the flight's hero
```

Reveal markup on reading pages: `data-split` for headings (no links inside), `data-block` for paragraphs and blocks
(a flex or grid container gets its mask outside it), `data-items` or `data-items="fade"` for lists (use fade when the
item's own box must stay intact, e.g. chips or definition rows), `data-img` for figures, `data-delay` / `data-stagger`
to tune. Never put a hairline on the last item with `:last-child` inside a revealed list: the wrapper changes the
tree; put the closing line on the list instead.

## Motion inventory (source of truth: `src/scripts/ui.js`, `index.astro`)

| Pattern | Spec |
|---|---|
| Easing | `cubic-bezier(0.22, 1, 0.36, 1)` for every transform |
| Character reveal | Each char in an `overflow:hidden` mask rises from `translateY(110%)`, 320 ms transform, 280 ms opacity |
| Stagger | 14 ms (HUD heads), 18 ms (chrome), 22 to 25 ms (titles, labels), 30 ms (hero), 35 ms (outro); later parts start `min(chars x 12, 260)` ms after earlier ones |
| Hide | Chars roll up and out to `translateY(-110%)` |
| Paragraph reveal | One masked block, 420 ms transform, 360 ms opacity |
| Swap | Old text rolls up, new rolls in from below (`swapper`) |
| Ticks | 30 ms stagger per tick, 520 ms smoothstep growth; tall near the current item |
| Stage HUD | `NN / NN` index, name, text, progress segments (26 to 42 px, accent when on), 0.4 s ease |
| Highlight | Term glows white with an accent text-shadow and lifts 3 px, 0.35 s ease |
| Stat | Number fades up from 8 px, 450 ms |
| Magnet | Spring pull toward the cursor on the main button (k 280, damping 20, radius 220 px) |
| Hero | First name top left, last name bottom right; they drift apart and fade over the first 700 px of scroll |
| Loader | Dot grid, accent bar along the top, large percentage |

Reading pages reuse these functions directly (`splitInto`, `blockInto`, `wrapInto`, `wrapAround`, `show`, `swapper`,
`makeTicks`, `magnet`) and add only: reveal on entering the viewport (once, no replay), 60 ms stagger between list
items, an 800 ms clip reveal for images, and line drawing for diagrams (520 ms per segment, same easing). The case
study's migration pipeline pins on desktop and plays one stage per scroll step, like a map stop. Chapter ticks rise
while the page moves and sink once reading resumes, so they never sit over text for long.

Reduced motion (`prefers-reduced-motion: reduce`): reveals become short fades with no movement, no hero drift,
no autoplay or travelling pulses, scroll-pinned diagrams become plain lists, and the flight drops its scroll roll and zoom.

## Design tokens

`--bg #07090f`, `--fg #d2e4f2`, `--dim #a9b6c4`, `--accent #8fd3ff`, titles `#fff`, secondary `#bababa`,
coral `#ff6b57` (critical, open point), gold `#ffd27a` (in development, low voltage), mint `#9fe3c9`.
Small text is uppercase 11 to 14 px with `0.02em` tracking; big titles have negative tracking. Gutter `--pad` 40 px
(20 px on phones).

## Content rules (do not break)

- Never invent employers, clients, dates, titles, metrics, data volumes or implementations.
- No client or utility names, internal system names, screenshots or proprietary schema details. The user asked for
  **no attribute-level detail**: no asset group codes, no internal field names, no geodatabase metadata columns.
- Diagrams and code on the case study are illustrative and labelled so. SQL and Python must stay valid.
- AI work carries an explicit status: Implemented, Prototype, In development or Planned concept.
- Skills show depth tiers, never percentages.
- Keep it clean: one idea per screen, short paragraphs, no filler.

## Facts the copy relies on (all from existing site copy or project READMEs)

- PwC: geospatial data scientist on the first Esri Platinum team; multiple iterations of bulk utility migrations;
  enhancing Esri Utility Network systems and their deployment across EAM platforms; Python, FME and CI/CD automation;
  electric and gas (UPDM) models, asset packages and rule bases; team management and product development.
- Advanced degrees in Geography and Remote Sensing; ISRO-IIRS advanced certifications.
- Project numbers come from `src/scripts/{research,energy,himachal}.js` HUD copy and the north-india-renewables README.

## Needs the owner's verification

- Employment dates, exact job title history, and any earlier GIS roles (none shown; add to `src/data/site.js`).
- Status labels for the MCP / ArcGIS assistant (`src/data/ai.js`): set conservatively to In development and Planned.
- Skill tiers (`src/data/skills.js`): which items are professional versus project-level.
- Smallworld, PostgreSQL/PostGIS, ArcPy and Power BI are listed as professional tools based on the upgrade brief.
- GitHub link points to the public profile only (project repositories are private).
- No resume file exists; add one to `public/` and to `site.js` to show a CV action.

## Run

```bash
npm ci
npx astro dev        # or: npx astro dev --background (see AGENTS.md)
npm run build        # static output in dist/, then the CSP check
npx astro preview
npx wrangler dev     # builds, then serves dist/ as Cloudflare does (public/_headers, public/_redirects)
```

Publishing is a push to `main` (see `DEPLOY.md`).
