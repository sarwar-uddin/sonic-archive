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
```

## Layout

| Path               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `packages/catalog` | Domain core: config, scanner, database (no HTTP) |
| `apps/server`      | CLI now; Express API from M3                     |
| `docs/adr`         | Architecture decision records                    |

## Status

Milestone **M0 (foundation)** is complete. The next milestone is M1: the
database schema and migrations.
