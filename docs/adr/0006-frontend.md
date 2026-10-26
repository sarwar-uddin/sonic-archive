# 0006 — Frontend: React + Vite, plain CSS, self-hosted fonts

- Status: accepted
- Date: 2026-10-26

## Decision

- **React 19 + Vite 8**, **React Router 8** (data router), and **TanStack
  Query** for server state. The catalog changes only when a scan runs, so
  responses are cached for a minute and never refetched on window focus.
- **Plain CSS with custom properties and CSS Modules**, no Tailwind. Design
  tokens live in `src/styles/global.css`; each component owns its module.
- **Fonts from npm (`@fontsource`)**: Fraunces (display), Inter Tight (UI),
  IBM Plex Mono (technical figures). There are no requests to font CDNs.
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
