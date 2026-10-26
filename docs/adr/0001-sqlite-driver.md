# 0001 — SQLite via better-sqlite3 + Drizzle ORM

- Status: accepted
- Date: 2026-10-26

## Context

The catalog is a single-user, local database of 10k–50k tracks. We want typed
queries and reviewable SQL migrations. Two SQLite drivers are viable on
Node 26: the built-in `node:sqlite` and the `better-sqlite3` native addon.

## Decision

Use **better-sqlite3** with **drizzle-orm 0.45.x** and **drizzle-kit**.

## Reasons

- Stable Drizzle (0.45.4) has no `node:sqlite` driver. It exists only in the
  1.0 release candidates. A long-lived project should not depend on a
  pre-release ORM.
- better-sqlite3 is built on N-API, so its binary keeps working across Node
  upgrades. It bundles SQLite with FTS5, which we need for search.
- Its API is synchronous. For one local user this is a feature: transactions
  are simple function calls and there are no interleaving surprises.

## Consequences

- It is a native dependency. pnpm 12 blocks dependency build scripts by
  default, so it must be listed under `allowBuilds` in `pnpm-workspace.yaml`.
  gcc/make/python3 are installed in case no prebuilt binary matches.
- Revisit when Drizzle 1.0 is stable. Switching to `node:sqlite` would then
  remove the native dependency.
