# docs — AGENTS.md

Documentation conventions for the ScanPal monorepo. Docs are written in
**Dutch** (code and AGENTS.md files are in English).

## The three layers

| File | Role |
|---|---|
| [`FEATURES.md`](FEATURES.md) | The single feature list — every feature has a number, an MVP flag (✅ MVP / 🔶 na-MVP) and a status (💡 geen plan · 📝 plan klaar · 🚧 in uitvoering · ✅ klaar) |
| [`ROADMAP.md`](ROADMAP.md) | Phases (0–6) with "klaar als" criteria; plan-overzicht table at the bottom |
| [`plans/NN-name.md`](plans/) | One detail plan per feature group |

## Plan conventions (`docs/plans/`)

- File name: `NN-kebab-name.md`, `NN` = next free number, registered in
  FEATURES.md (`Plan` column) and ROADMAP.md (plan-overzicht) **at the same
  time** the file is created.
- Required sections (see 01–06 for the established style):

```
# Plan: <feature title>
**Doel** · **Status** · ## Besluiten (bevestigd <datum>)
## Uitgangssituatie (code vandaag) · ## Contract / DB / API
## Stappen · ## Open vragen · ## Acceptatiecriteria
```

- Decisions are recorded explicitly in "Besluiten" with a date — strikethrough
  resolved open questions rather than deleting them.
- Status flow: plan written → set FEATURES.md status 📝 → work starts → 🚧 →
  done → ✅ (and ROADMAP "Klaar als" is met).

## Rules

- Never duplicate a contract in docs: point to `packages/shared` schemas and
  the relevant plan instead.
- One plan can cover multiple features; the FEATURES.md `Plan` column maps
  features → plans, feature numbers in plans refer back to FEATURES.md.
- Keep FEATURES.md the canonical numbering; renumbering is forbidden (numbers
  are referenced from ROADMAP and plans).
- AGENTS.md files (English) describe *current* architecture; plans describe
  *planned* work — when a feature ships, its plan stays as the record.
