# 0006 — Frontend: React + Vite, plain CSS, self-hosted fonts

- Status: accepted
- Date: 2026-10-26

## Decision

- **React 19 + Vite 8**, **React Router 8** (data router), and **TanStack
  Query** for server state. The catalog changes only when a scan runs, so
  responses are cached for a minute and never refetched on window focus.
- **Plain CSS with custom properties and CSS Modules**, no Tailwind. Design
  tokens live in `src/styles/global.css`; each component owns its module.
- **Fonts from npm (`@fontsource`)**: one variable grotesque, **Archivo**
  (width 62–125%, weight 100–900), stretched from condensed poster headlines
  to wide catalogue labels, plus **IBM Plex Mono** for catalogue numbers and
  technical figures. There are no requests to font CDNs. (Revised after the
  full-library scan: the original Fraunces/Inter Tight pairing read as a
  literary magazine; the collection of first pressings, Japanese OBI-strip
  CDs, jazz and heavy/prog sleeves called for poster-like condensed type.)
- **Collection-led motifs**: artist divider cards standing in the grid like
  record-shop bins; an OBI strip beside the album cover; pressing details
  parsed from folder names shown as edition chips; artist cover mosaics;
  blurred-cover hero backdrops.
  Verified: a headless browser loading every page made zero non-local
  requests.
- **Filters live in the URL** (`?genre=3&res=24bit`), so views can be
  bookmarked and Back works.
- The tracks table is a real `<table>`, virtualized (`@tanstack/react-virtual`)
  with infinite loading, so 50k rows stay smooth.
- Response types are imported from `@sonic-archive/contracts`, the same
  definitions the server uses.

## Production

`pnpm start` builds the web app and serves it from the API process on
`127.0.0.1:4317`, with a strict CSP: same-origin scripts only, no inline
scripts, no framing.

## Consequences

- Inline style attributes are allowed by the CSP (`style-src 'unsafe-inline'`)
  for the generated placeholder sleeves. Inline scripts are not.
- Component tests run in jsdom against the real route tree with `fetch`
  mocked. Visual checks were done with a headless browser outside the repo;
  a committed end-to-end suite (Playwright) is a candidate for later.

## Charts (M12)

Charts are plain HTML/CSS, no chart library: a handful of ranked bars, one
column chart and one part-to-whole bar do not justify a dependency. One
series hue (`--series-1`, the reference blue, validated on the ink surface)
keeps the OBI red and the rip-verdict colors free to mean what they mean.
Every mark has a tooltip on hover and keyboard focus; values are at bar tips,
the column chart has a table view, and the stacked bar's legend lists every
count, so nothing depends on hovering or on color alone.
