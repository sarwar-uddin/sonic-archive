# 0004 — Biome for lint/format, Vitest for tests

- Status: accepted
- Date: 2026-10-26

## Decision

- **Biome** handles linting, formatting, and import ordering. typescript-eslint
  depends on the TypeScript JavaScript API, which TS 7 does not yet provide
  in stable form. Biome has no such dependency, and it is one fast tool
  instead of ESLint plus Prettier.
- **Vitest** runs all tests. It shares Vite's transform pipeline, so the web
  app (M4) needs no separate test toolchain.
- `pnpm check` (typecheck, lint, test) is the gate every milestone must pass.

## Consequences

- Biome's rule set is smaller than ESLint's ecosystem, and there is no
  type-aware linting. Strict compiler options cover most of that gap
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
