# Sahrul Romadi — Portfolio

A personal portfolio that works like a slide deck: full-screen slides you move through left and right, the way you would in PowerPoint.

**Live:** [sahrulromadi.vercel.app](https://sahrulromadi.vercel.app)

## Features

- **Slides, not a long page** — horizontal CSS scroll-snap; every input moves exactly one slide.
- **Navigation** — `←` `→`, `Space` / `Shift+Space`, `PageUp` / `PageDown`, `Home` / `End`, mouse wheel or trackpad (one gesture = one slide), swipe on touch screens, arrow buttons, and slide dots.
- **Deep links** — the URL follows the current slide (`/#experience`, `/#contact`), so any slide can be shared directly.
- **Overview mode** — press `O` (or the grid button) to see every slide as a thumbnail; click one to jump to it, `Esc` to go back.
- **Fits the screen** — no scrolling at 100% zoom on laptop windows down to 1280×600; on phones a tall slide scrolls inside itself.
- **Accessible** — slides off screen are `inert` (Tab stays on the visible slide), visible focus outlines, WCAG AA colour contrast, `prefers-reduced-motion` respected.
- **Visit tracking** — every page load records IP address, user agent and time to a Supabase table.
- **Light** — static HTML with a small inlined navigation script; no UI framework.

## Tech stack

| Part | Choice |
| --- | --- |
| Site | [Astro](https://astro.build) 7, static output |
| Styling | Plain CSS with custom properties |
| Hosting | [Vercel](https://vercel.com) via `@astrojs/vercel` (pages prerendered, one function for `/api/hit`) |
| Tracking store | [Supabase](https://supabase.com) Postgres, written through its REST API (no client library) |

## Project structure

```
├── astro.config.mjs
├── public/
│   └── favicon.svg
├── scripts/
│   └── smoke.mjs              # headless navigation test (Chrome DevTools Protocol)
├── src/
│   ├── components/
│   │   ├── Deck.astro         # slide container, navigation bar, overview mode, tracking beacon
│   │   ├── Slide.astro        # one full-screen slide
│   │   └── Contacts.astro     # email / LinkedIn / GitHub links with icons
│   ├── content/projects/      # one Markdown file per case study
│   ├── content.config.ts      # case study schema
│   ├── pages/
│   │   ├── index.astro        # profile data + all slides
│   │   └── api/hit.ts         # visit tracking endpoint
│   └── styles/global.css
└── docs/
    ├── PRD.md                 # product requirements
    └── plan/                  # dated implementation plans
```

## Editing content

- **Profile, experience, applications diagram** — the `profile` object at the top of [`src/pages/index.astro`](src/pages/index.astro).
- **Case studies** — one file per project in [`src/content/projects/`](src/content/projects); slides are ordered by `order`:

  ```markdown
  ---
  title: Plant Inventory
  order: 2
  summary: Inventory management application for the Plant division, with every site on one set of records.
  stat: { value: '5+', label: sites }
  before: Inventory was managed in Excel, and the data at each site was different.
  built:
    intro: 'A website that manages:'
    items: [Stock in and stock out, Lending and borrowing, Stock transfer]
    note: I also fixed the data so sites share the same records.
  after:
    - All assets at each site are monitored
    - Min and max stock levels are visible
  ---
  ```

- **CV** — add `public/cv.pdf`; the *Download CV* button on the last slide appears automatically.
- **Link preview image** — `public/og.png` (1200×630, keep it under ~300 KB for WhatsApp); `site` in [`astro.config.mjs`](astro.config.mjs) turns it into the absolute `og:image` URL.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # production build into .vercel/output
npm run check    # type check
```

### Smoke test

With `npm run dev` running in another terminal:

```bash
node scripts/smoke.mjs                # all checks, prints PASS/FAIL
node scripts/smoke.mjs ./screenshots  # also saves screenshots
```

Set `CHROME=<path to chrome or msedge>` if Chrome is not at its default Windows location, and `BASE=<url>` to test another server, for example a Vercel preview.

## Visit tracking

1. When the page loads, the browser calls `navigator.sendBeacon('/api/hit')`.
2. [`src/pages/api/hit.ts`](src/pages/api/hit.ts) reads the IP from Vercel's `x-real-ip` header and the `user-agent` header.
3. It inserts one row into `portfolio_visits` through the Supabase REST API; `visited_at` is filled by the database.

Visits during `npm run dev` are not recorded.

**Table** (run once in the Supabase SQL Editor):

```sql
create table public.portfolio_visits (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now(),
  ip_address text not null,
  user_agent text not null
);
-- RLS on with no policies: the publishable key can neither read nor write; only the server's secret key can insert.
alter table public.portfolio_visits enable row level security;
grant insert on public.portfolio_visits to service_role;
```

**Environment variables** (Vercel → Settings → Environment Variables; locally in `.env`, which is git-ignored):

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | the project's secret key (`sb_secret_…`) |

**Reading the data** (times in WIB):

```sql
select visited_at at time zone 'Asia/Jakarta' as visited_at_wib, ip_address, user_agent
from portfolio_visits
order by visited_at desc
limit 100;
```

## Deployment

1. Import the GitHub repository at [vercel.com/new](https://vercel.com/new); the Astro preset is detected automatically.
2. Add the two environment variables above.
3. Deploy. Every push to the `production` branch redeploys the site; other branches get preview URLs.
