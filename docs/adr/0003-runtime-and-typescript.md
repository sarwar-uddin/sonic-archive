# 0003 — Node 26 (pinned) with native TypeScript type stripping

- Status: accepted
- Date: 2026-10-26

## Context

Arch ships a rolling `nodejs` package (26.12.1 today) that will move to
Node 27 without warning. Node 26 becomes LTS in late October 2026.
Corepack was removed from Node 25+.

## Decision

- Pin Node in `mise.toml` (exactly 26.12.1). pnpm is pinned via
  `packageManager: pnpm@12.15.0`.
- Run server and CLI TypeScript **directly with Node** (native type
  stripping). There is no build step and no `tsx`.
- Use TypeScript 7 (the native compiler) for type-checking only (`noEmit`).
  The required settings are `erasableSyntaxOnly`, `verbatimModuleSyntax`, and
  explicit `.ts` extensions in relative imports.
- Workspace packages export their `src/*.ts` directly.

## Verified

Node strips types only outside `node_modules`. pnpm links workspace packages
through symlinks, and Node resolves those to their real paths
(`packages/...`), so stripping works. `pnpm paths` exercises exactly this in
M0.

## Consequences

- No enums, namespaces, or constructor parameter properties. Use string-literal
  unions and explicit fields instead.
- If a dependency ever needs real transpilation, fall back to `tsx`. If a tool
  breaks on TS 7, fall back to TS 6.x.
