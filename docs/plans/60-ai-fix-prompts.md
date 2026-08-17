# Plan: AI fix-prompts (paste-ready fixes per finding + per scan)

**Doel**: Elke finding (en de hele scan) omzetten in een copy-paste prompt voor Cursor/Claude/Windsurf: context, locatie (bestandspad bij gekoppelde GitHub-repo, anders route + element), de remediatie en een "laat een diff zien"-instructie. "Eén prompt fix ze allemaal" (CheckVibe: "every finding ships with an AI-ready fix prompt").

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Pure templates, geen LLM-call**: promptgeneratie is deterministische stringbouw uit de finding + template per check-id in `packages/shared` — goedkoop, geen externe dependency
2. **On-demand + inline**: optioneel berekend veld `fix_prompt` op finding-detail (`GET /api/findings/[id]`) én een `GET /api/scans/[id]/fix-prompt` die alle niet-fixed/ignored findings groepeert (max ~1500 tokens, per bestand/route gegroepeerd)
3. **Locatie**: bij gekoppelde `github_repo` (plan 04) + semgrep/gitleaks-findings: bestandspad uit de finding; HTTP-findings: route_url (plan 54) + element-selector/evidence; zonder repo: alleen URL + check-uitleg
4. **Prompt-structuur** (Engels, want voor AI-editors): rol + doel, probleem (finding-titel + ernst), locatie, remediatie uit de finding (feature 8/20), vereisten (test draait, geen ongerelateerde wijzigingen), "lever een diff"
5. **UI**: copy-knop per finding ("Copy fix prompt") + "Generate fix prompt"-knop bovenaan de findings; export.md (feature 9) krijgt optioneel de prompts per finding mee
6. **MCP**: promptgeneratie als tool in de MCP-server (63) — zelfde helper

## Uitgangssituatie (code vandaag)

- Findings met remediatie + fixed/ignored (feature 8/20, plan 09); `github_repo` op sites (plan 04); semgrep/gitleaks-findings met bestandspaden (46/47)
- Export (9/21, plan 10) bouwt op `buildReportData`; MCP-server (51) wrapt REST-routes

## Contract / DB / API

- Shared: `fixPromptTemplate` per catalog-check-id + fallback-generiek template; `fixPromptSchema` (`{ prompt: string, findings_covered: number, truncated: bool }`)
- `GET /api/findings/[id]/prompt` (authz als scans) → één prompt
- `GET /api/scans/[id]/fix-prompt` → gegroepeerde prompt; `truncated` bij > ~1500 tokens met "en N meer" (vgl. plan 10 top-100-cap)
- Geen DB-wijziging (prompts worden niet opgeslagen)

## Stappen

1. Shared: templates per check-id (starten met de MVP-catalog uit plan 06; onbekende check-ids → fallback), prompt-builder + truncatie + tests
2. Routes `GET /api/findings/[id]/prompt` en `GET /api/scans/[id]/fix-prompt` + authz
3. UI: copy-knoppen (navigator.clipboard) op finding-detail + findings-lijst; "Generate fix prompt"-actie
4. Export (plan 10): optionele `include_prompts`-scope → prompts in MD/PDF
5. MCP (63): `generate_fix_prompt`-tool
6. Tests: template-keuze per check-id, fallback, truncatie, grouping per bestand/route, geen prompts voor fixed/ignored

## Open vragen

- Engelse prompts zijn het doel (AI-editors), maar de UI is Nederlands — labels "Copy prompt" of "Kopieer prompt"?
- Welke detail-prijs per finding meegeven in de prompt (evidence request/response is al lang; wel/niet opnemen)?
- Template-versiebeheer: templates veranderen met de check-catalog — versie op de prompt zetten ("prompt v3")?

## Acceptatiecriteria

- [ ] Elke finding levert een copy-paste prompt met context, locatie en remediatie; onbekende check-ids krijgen een werkende fallback
- [ ] Scan-prompt groepeert niet-fixed/ignored findings per bestand/route; bij > 1500 tokens truncatie met "en N meer"
- [ ] Bestandspaden alleen bij gekoppelde repo/findings; anders route + element
- [ ] Copy-knoppen werken; prompts belanden optioneel in het MD-rapport
- [ ] MCP-tool deelt dezelfde helper (geen duplicatie)
