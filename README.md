# Sonic Archive

A local-first, album-centric catalog for a personal lossless music collection.
The library is treated as strictly read-only; see [docs/safety.md](docs/safety.md).

## Requirements

- [mise](https://mise.jdx.dev) (pins Node 26.12.1 via `mise.toml`)
- pnpm 12.15.0

## Getting started

```sh
mise install
pnpm install
pnpm check      # typecheck + lint + tests
pnpm paths      # show where config, database and cache live
pnpm db:migrate # create or upgrade the catalog database (backs up first)
pnpm scan       # index the library: read-only, needs --confirm (see docs/safety.md)
```

## Layout

| Path               | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `packages/catalog` | Domain core: config, scanner, database (no HTTP)                       |
| `apps/server`      | CLI now; Express API from M3                                           |
| `docs/adr`         | Architecture decision records                                          |
| `test-fixtures`    | Synthetic audio library for tests ([details](test-fixtures/README.md)) |

## Changing the database schema

1. Edit `packages/catalog/src/db/schema.ts`.
2. Run `pnpm --filter @sonic-archive/catalog db:generate --name <what-changed>`.
3. Read the generated SQL in `packages/catalog/drizzle/`. If it contains
   `DROP` or `DELETE`, confirm that no data is lost, then add
   `-- safety-reviewed: <reason>` to that statement. Otherwise tests fail and
   the runner refuses to apply it.
4. `pnpm check`, then commit the schema, SQL, and `meta/` together.

## Status

Milestones **M0 (foundation)**, **M1 (database)** and **M2 (scanner)** are
complete. Next is M2.5, an authorized sample scan of one or two folders from
the real library, and then M3, the read-only API.
