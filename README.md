# Sahrul Romadi — Portfolio

A personal portfolio that works like a slide deck: full-screen slides you move through left and right, the way you would in PowerPoint.

**Live:** [sahrulromadi.vercel.app](https://sahrulromadi.vercel.app)

## Features

- **3D intro** — the first slide is a short Three.js scene: paper forms burst into pixels in a scanner, reassemble as data, stream into one server, then the scanner and server sink away and live dashboards switch on under a closing line. It plays again every time you return to it, or press *Replay*.
- **Slides, not a long page** — horizontal CSS scroll-snap; every input moves exactly one slide.
- **Navigation** — `←` `→`, `Space` / `Shift+Space`, `PageUp` / `PageDown`, `Home` / `End`, mouse wheel or trackpad (one gesture = one slide), swipe on touch screens, arrow buttons, and slide dots.
- **Deep links** — the URL follows the current slide (`/#experience`, `/#contact`), so any slide can be shared directly.
- **Overview mode** — press `O` (or the grid button) to see every slide as a thumbnail; click one to jump to it, `Esc` to go back.
- **Fits the screen** — no scrolling at 100% zoom on laptop windows down to 1280×600; on phones a tall slide scrolls inside itself.
- **Accessible** — slides off screen are `inert` (Tab stays on the visible slide), visible focus outlines, WCAG AA colour contrast, `prefers-reduced-motion` respected (the intro shows its final frame instead of playing).
- **Light** — static HTML with a small inlined navigation script; no UI framework. The intro scene with Three.js (~145 KB gzip) is downloaded only when the intro slide is shown.

## Tech stack

| Part | Choice |
| --- | --- |
| Site | [Astro](https://astro.build) 7, static output |
| Styling | Plain CSS with custom properties |
| 3D intro | [Three.js](https://threejs.org) with bloom post-processing; shapes built in code (no model files) |
| Hosting | [Vercel](https://vercel.com), static files from `dist/` |

## Project structure

```
├── astro.config.mjs
├── public/
│   └── favicon.svg
├── scripts/
│   └── smoke.mjs              # headless navigation test (Chrome DevTools Protocol)
├── src/
│   ├── components/
│   │   ├── Deck.astro         # slide container, navigation bar, overview mode
│   │   ├── Intro.astro        # first slide: overlays + play/pause when the slide is shown
│   │   ├── intro-scene.ts     # its 3D paper → digital scene (Three.js), loaded on demand
│   │   ├── Slide.astro        # one full-screen slide
│   │   └── Contacts.astro     # email / LinkedIn / GitHub links with icons
│   ├── content/projects/      # one Markdown file per case study
│   ├── content.config.ts      # case study schema
│   ├── pages/index.astro      # profile data + all slides
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
npm run build    # production build into dist/
npm run check    # type check
```

### Smoke test

With `npm run dev` running in another terminal:

```bash
node scripts/smoke.mjs                # all checks, prints PASS/FAIL
node scripts/smoke.mjs ./screenshots  # also saves screenshots
```

Set `CHROME=<path to chrome or msedge>` if Chrome is not at its default Windows location, and `BASE=<url>` to test another server, for example a Vercel preview.

## Deployment

1. Import the GitHub repository at [vercel.com/new](https://vercel.com/new); the Astro preset is detected automatically.
2. Deploy. Every push to the `production` branch redeploys the site; other branches get preview URLs.
