# Phase-1 Survey Report — Plan 64 Team seats + client-workspaces + white-label

## Decision Packet

- **Role/Task**: Phase Surveyor (read-only), phase-1, whole-plan survey of `docs/plans/64-team-seats-white-label.md` (6 steps). Run `20260818T110500Z-opencode-7f2d`.
- **Verdict**: READY TO PLAN with corrections. 3 of 4 "missing" claims confirmed; **1 claim is false** (seat limit already exists, wired + tested). Foundation for all 6 steps is present. No blockers; 3 open plan decisions remain unresolved by code (see Risks).
- **Changed paths**: none. Read-only survey. Only the two output files were written (audit + this report).
- **Criteria summary**: all survey questions A–H answered with file/line evidence below.
- **Verification summary**: greps (`white_label|seats|branding|workspace|report_token|mask|randomBytes…`) across `apps/web`, `packages/*`; `git status`/`git show` for route renames; full reads of DB migrations 001/002/003/006/012/015/016/019/024/025, `packages/shared/src/{plans,report,scans,public-status,index}.ts`, `packages/scan-core/src/{credits,finish-scan,index}.ts`, `apps/web/lib/{invites-core,authz,rate-limit,sites-core,scans-core,billing,billing-core,credits}.ts`, `apps/web/lib/report/*`, all report/teams/invitations/public-status API routes, settings/billing pages, root + web package.json, vitest config, and 2 test files. No tests/typecheck/lint/build run (read-only rule).
- **Scope/preservation result**: working tree treated as baseline (has unrelated uncommitted changes); nothing modified.
- **Major-log ids**: `MFL-20260818-001` (seat-limit claim disproven) and `MFL-20260818-002` (report content-route rename) appended to major-findings-and-fixes.md.
- **Unresolved risks / blockers**: (1) seats-definition (owner counted? pending vs accepted?) unresolved in code; (2) per-scan vs per-site portal token unresolved; (3) workspace roles unresolved. Plus: `member_limit` today returns 400 not 409; no `max` plan exists anywhere (DB check, zod, Stripe).
- **Evidence paths**: `current-state-audit.md` (raw evidence + predicates), `report.md` (this file).
- **FAST-PATH ELIGIBLE: YES** — surveys are cheap to re-run; the false seat-limit claim is corrected with reproducible evidence, no risky assumptions were made.

---

## Predicates

PRESENT = symbol/file exists in the working tree (untracked counts). WIRED = reachable from runtime (route registered, exported fn called through a live path, schema re-exported from package index). REACHABLE = present + wired but gated on external config (Stripe env). PARTIAL = present + wired but incomplete vs its own contract. MISSING = predicate search over the stated boundary returned nothing. STALE = plan/doc claim no longer matches the tree.

---

## A. DB layer (packages/db)

- **Latest migration / naming**: `025_scan_crux.sql`; monotonic `NNN_name.sql`, up-only, rollback as SQL comments (e.g. `006_sites.sql:12-18`). Runner `packages/db/src/migrate.ts` (`pnpm db:migrate`), tracks files in `schema_migrations`, each file in a transaction. Next number is `026`.
- **`teams`**: `id uuid pk default gen_random_uuid()`, `name text not null`, `created_at` (`001_users_teams_memberships.sql:17-21`). No `branding`.
- **`memberships`**: PK `(team_id, user_id)`, `role` check `('owner','member')`, `status` check `('pending','accepted')`, `invited_by`, index `memberships_user_id_idx` (`001:23-33`).
- **`sites`**: `team_id` FK cascade, `url`, unique `(team_id,url)` (`001:35-41`); `006` adds github/label/last_scan_*/uptime_state; `019` adds `public_status_slug` with partial unique index (`sites_public_status_slug_key`). No `workspace_id`.
- **`scans`**: `site_id` FK, status/progress/score/`findings jsonb`/timestamps (`001:43-52`); `005` progress_details; `016` `category_scores jsonb`; `021` `diff`; `025` `crux`. No `report_token`, no `expires_at`.
- **`subscriptions`**: `team_id` PK, `plan` check **`('free','pro')`** (`003:4-14`), `012` adds `cancel_at_period_end` + `interval`. **No `max` plan value** — a Max plan needs a migration (constraint change), a `planIdSchema`/`plans` update in shared, a Stripe price env, checkout + webhook resolution (`apps/web/lib/billing.ts:24-29`, `apps/web/lib/billing-core.ts:107,147`, `apps/web/lib/env.ts:17-19`).
- **`api_keys`**: has nullable `expires_at` (`packages/db/src/index.ts:202-213`) — existing expiry pattern; `invitations.expires_at not null` (`002:10`) — token+expiry pattern to mirror for report tokens.
- **`reports`**: `format ('md','pdf')`, `content bytea`, indexes `reports_team_created_idx`, `reports_site_idx` (`015`). No token column.
- **Expected `branding`/`workspaces`/`workspace_id`/`report_token`/`scans.expires_at`**: all **MISSING** (grep across `packages/db` returned nothing).
- **RLS**: `024_rls_policies.sql` enables RLS only on `users`, `teams`, `memberships`, `subscriptions`, `api_keys`, `api_key_usage`, with select-policies through security-definer `public.is_team_member`/`is_team_owner` (`024:33-62`) and an `auth.uid()` stub for non-Supabase (`024:16-29`). **RLS is NOT enabled on** `sites`, `scans`, `reports`, `checks`, `invitations`, `uptime_*`, `threat_*`. New `workspaces`/`report_tokens` tables would decide whether to follow the (partial) 024 pattern.
- **Migration conventions**: index names `<table>_<cols>_idx` / `_key` for unique; partial unique indexes used twice (`invitations_pending_unique` `002:16-17`, `sites_public_status_slug_key` `019:9-11`).
- **Client/typed helpers**: `packages/db/src/index.ts` exports `*Row` types + const arrays (`planIds=["free","pro"]` at `:6`). No ORM; `pg` Pool + raw SQL.

## B. packages/shared — contracts & where plan features live

- Existing zod: `userRoleSchema`, `membershipStatusSchema`, `teamSchema`, `membershipSchema`, `inviteInputSchema`, `invitationSchema`, `teamMemberSchema`, `roleChangeSchema` (`src/index.ts:4-104`); plans (`src/plans.ts`); report contracts (`src/report.ts`); scans (`src/scans.ts`); public-status (`src/public-status.ts`). **`brandingSchema`, `workspaceSchema`, `reportTokenSchema`: MISSING.**
- **Plan features live in `packages/shared/src/plans.ts`**: `Plan.features = { uptime, github, activeTests, onDeploy }` (`:27-34`), `maxMembers` (`:22`). No `seats`, no `white_label`, no `max` plan id. `planIdSchema = z.enum(["free","pro"])` (`:3`).
- Feature lookup happens in `packages/scan-core/src/credits.ts`: `getPlanForTeam` (`:60`), `assertPlanFeature(db, teamId, feature)` (`:217`), `spendCredit` (`:122`); re-exported by the webapp (`apps/web/lib/credits.ts`). Runtime checks: `apps/web/app/api/scans/route.ts:47-58` (403+upsell on `activeTests`), dashboard/sites UI read `plan.features.*`. Seat limit reads `plans[planId].maxMembers` in `apps/web/lib/invites-core.ts:62-87`.

## C. Invite route (plan 02) — seat limit ALREADY EXISTS

- POST invite: `apps/web/app/api/teams/[teamId]/invitations/route.ts` — `requireOwner` authz (`lib/authz.ts:40`), `inviteInputSchema`, `createInvitation`; error map: `already_member`/`pending_exists` → 409, **`member_limit` → 400, no upsell** (`:56-60`).
- Accept: `apps/web/app/api/invitations/[token]/accept/route.ts` (404/410/403/400). Lookup GET: `app/api/invitations/[token]/route.ts`. Listing + invite mgmt: owner-only (`teams/[teamId]/invitations/route.ts:76`, `members/[userId]/route.ts`).
- Role model: `owner`/`member` in memberships + invitations; `last_owner` guard (`invites-core.ts:285-294`).
- **Seat limit: PRESENT + WIRED + TESTED** — `apps/web/lib/invites-core.ts:62-87` (`maxMembersForTeam`, `assertSeatAvailable`, throws `InviteError("member_limit")`), invoked in `createInvitation` (`:117-129`; seats = accepted memberships + unexpired pending invites) and `acceptInvitation` (`:197-204`; seats = accepted memberships). Limit source: `plans[planId].maxMembers` (free=3, pro=10). Tests: `apps/web/lib/__tests__/invites-core.test.ts:295-311` (blocked at 3, allowed on pro) and `:382-394` (accept blocked).
- **Upsell shape used elsewhere**: `{ error, upsell: { plan: "pro" } }` on 403 (`api/threats/route.ts:35`, `api/sites/[id]/schedule/route.ts:50`, `api/scans/route.ts:53` + optional `feature` key). Clients: `components/sites-manager.tsx:171`, `scan-result.tsx:793`, `onboarding-wizard.tsx:32`; checkout POST body `{ planId: upsell?.plan ?? "pro" }` (`sites-manager.tsx:335`).
- **Implication for step 2**: it is a modification, not a new capability — change `member_limit` to 409 + upsell payload, add `seats`/`white_label` flags and a `max` plan. The plan's "invite-route kent geen seat-limiet" is **STALE**.

## D. Export renderer (plan 10) + settings UI (plan 16)

- Routes: `apps/web/app/api/reports/[scanId]/route.ts` (generation, tracked), `apps/web/app/api/reports/route.ts` (history, tracked), `apps/web/app/api/reports/[scanId]/content/route.ts` (**untracked; renamed from `[id]/content` which is `git D`** — identical logic, only param renamed; still passed as `reportId` to `getReportContent`, `store.ts:127-141`). Tests updated: `lib/__tests__/report-content-route.test.ts` (6-line diff).
- Renderer lib `apps/web/lib/report/`: `data.ts` (`buildReportData` team-scoped at `:53`, `reportFilename` = `scanpal-{host}-{date}` at `:129-137`), `pdf.tsx` (`renderPdf` `:231`), `markdown.ts` (`renderMarkdown` `:40`), `store.ts`.
- **Hardcoded ScanPal branding**: `pdf.tsx:138` "ScanPal Report", `pdf.tsx:215` "Generated by ScanPal"; `markdown.ts:46` "# ScanPal Report", `markdown.ts:124` "_Generated by ScanPal_". Also public status page header/footer (`(public)/status/[slug]/page.tsx:77-79,152-155`).
- Settings UI: `apps/web/app/(dashboard)/settings/{profile,team,notifications,api-keys,webhooks}/page.tsx` (server components) + `components/settings-nav.tsx` (LINKS array `:6-12`) + client panels (`components/team-settings.tsx`). A branding settings page would extend SettingsNav + add a panel; `PATCH /api/teams/[teamId]/branding` would mirror the owner-only patterns in `app/api/teams/[teamId]/*`.
- Report data is fetched for export via `buildReportData(pool, scanId, teamId)` from the generation route (`[scanId]/route.ts:53`), validated by `reportDataSchema`, and rendered by `renderPdf`/`renderMarkdown`; PDF/MD content is persisted via `saveReport` and later served from `getReportContent` (no regeneration).

## E. Public status page (plan 57) — portal template

- SSR page: `apps/web/app/(public)/status/[slug]/page.tsx` (`force-dynamic` `:14`; `generateMetadata` robots `{index:false,follow:false}` `:21-26`). `(public)` route group contains only this page — **no `layout.tsx`**.
- JSON feed: `apps/web/app/api/public/status/[slug]/route.ts` — slug validation `:25`, per-IP Redis rate limit `public:${ip}` 60/min with fail-open `:34-52`, `X-Robots-Tag: noindex, nofollow` `:76`, cache headers `:73-75`.
- Rate-limit helper: `apps/web/lib/rate-limit.ts` `checkRateLimit(key, limit, windowSeconds=60)` (Redis INCR+EXPIRE). Redis singleton: `lib/redis.ts`.
- Read-only data-builder (reuse pattern): `apps/web/lib/public-status-core.ts` `getPublicStatus(db, slug)` — returns null → 404, exposes only public-safe data; contract in `packages/shared/src/public-status.ts`.
- No `app/robots.ts`; noindex = metadata robots + `X-Robots-Tag` (also `app/h/[token]/route.ts:22`).

## F. Tests

- Runner: root `pnpm test` → `pnpm --filter web test` → `vitest run`. Config `apps/web/vitest.config.ts`: node env, `lib/**/*.test.ts`, `@` alias. Other packages have their own vitest configs.
- **No DB-in-test**: two patterns — hand-rolled `fakePool()` for core logic (invites-core.test.ts, credits.test.ts, billing-core.test.ts) and `vi.mock("@/lib/db")`/`vi.mock("@/lib/api-auth")`/`vi.mock("server-only")` for route tests (report-content-route.test.ts, public-status-route.test.ts). No testcontainers/docker/pg-mem.
- Naming: `*-core.test.ts`, `*-route.test.ts`, fixtures `report-fixtures.ts` (`makeFinding`/`makeRenderData`). Existing coverage relevant to plan 64: invites (incl. seat limit), credits/billing, report-data/markdown/pdf/store/content, public-status-core/route.

## G. Predicate verification ("no branding, no workspaces, no portal, no seat limit")

| Claim | Verdict | Evidence |
|---|---|---|
| No branding tokens | **CONFIRMED MISSING** | grep `white_label|whiteLabel|white-label|branding` in `apps/web`, `packages/*` → zero code hits (only `docs/*`). `teams` has no branding column. |
| No workspaces | **CONFIRMED MISSING** | grep `workspace` in `apps/web`, `packages/*` → zero hits. No table, no FK, no route. |
| No portal route | **CONFIRMED MISSING** | `app/(public)` = only `status/[slug]/page.tsx`; `app/api/public/` = only `status/[slug]/route.ts`. |
| No seat limit | **DISPROVEN** | `apps/web/lib/invites-core.ts:62-87` + tests `invites-core.test.ts:295-311,382-394`. Limit exists; what's missing is **409 + upsell** (currently 400) and a **Max plan**. |

## H. Reusable helpers for the portal/token work

- Token generation: `generateToken()` (`invites-core.ts:58`, 32-byte hex), `api-keys-core.ts:15` (base64url), `threats-core.ts:328` (base64url), `generatePublicStatusSlug()` + `isValidPublicStatusSlug` (`shared/public-status.ts:51-61`) — the shared-location slug pattern (16 hex chars) is the closest template for a `reportTokenSchema` helper (12+ chars required by plan).
- noindex: `generateMetadata` robots + `X-Robots-Tag` header (E above).
- Masked-findings: per-string masks `maskSecret` (`shared/bundle-secrets.ts:128`), `maskMatch` (`shared/sast-findings.ts:20`). **No whole-finding / whole-report redaction builder exists** — `buildReportData` returns full evidence; the portal needs a new masked read-only data-builder (mirroring `getPublicStatus`'s pattern) that reuses the mask helpers and `evidenceText`.

---

## Suggested independently-reviewable task units (measurement, not design)

1. **Unit 1 — Migration + shared contracts** (`026_*.sql` for `teams.branding jsonb not null default '{}'` + `workspaces` + `sites.workspace_id` + token storage as plan decides; `packages/shared/src/{branding,workspaces,report-tokens}.ts` + index exports; token helpers reusing the `generatePublicStatusSlug` pattern). Open: per-scan `scans.report_token` vs `report_tokens` table (plan leaves both).
2. **Unit 2 — Seat-check 409 + upsell + Max plan** (modify `invites-core.ts` error mapping + route; add `seats`/`white_label` feature flags + `max` plan in `plans.ts`, DB constraint migration, Stripe price env + `resolvePlanFromPrice`, webhook sync, pricing UI). Open: seats-definition.
3. **Unit 3 — Branding tokens + settings UI + renderer reads branding** (`PATCH /api/teams/[teamId]/branding`, settings page/panel, thread branding into `ReportRenderData` → `pdf.tsx`/`markdown.ts`; filename prefix `scanpal-` at `data.ts:136`).
4. **Unit 4 — Workspaces CRUD + site-link + membership scoping** (owner-only routes `POST /api/teams/workspaces`, `PATCH /api/teams/[id]/workspaces/[wid]`; extend team-scoped queries in `sites-core.ts`, `scans-core.ts`, `report/store.ts`, `report/data.ts` for workspace members). Open: workspace roles.
5. **Unit 5 — Public portal** (`GET /api/public/report/[token]` + `(public)/report/[token]/page.tsx`; masked read-only data-builder; noindex + per-IP Redis rate limit; token generation on completed scan — hook point: `finishScan` in `packages/scan-core/src/finish-scan.ts` or lazy on first request). Open: token lifecycle/expiry.
6. **Unit 6 — Tests** (existing conventions: fakePool / vi.mock; seat 409+upsell, branding in PDF/MD, workspace scoping, token-authz brute-force, masked payloads).

## Risks / open items (evidence-based)

- **Seats-definition** (plan open question): current count = accepted memberships + unexpired pending invites on create, accepted memberships only on accept (`invites-core.ts:117-129,197-204`). Owner is already included in the count (they're an accepted membership). Not resolvable from code.
- **Per-scan vs per-site token** (plan open question): no existing pattern; `reports` rows are per (scan,format), `reports` history is per scan. Not resolvable from code.
- **Workspace roles** (plan open question): existing role model is flat owner/member with no per-subteam notion. Not resolvable from code.
- **`member_limit` semantics change**: currently 400; plan step 2 requires 409 + upsell — behavior change, must not silently break existing UI (currently no invite client shows the member_limit as 409).
- **Max plan is greenfield**: DB constraint, zod enum, planList, Stripe env, checkout, webhook plan-resolution, pricing cards, billing page (`isPro` checks) all assume two plans.

## Major-log entries written
`MFL-20260818-001` (seat-limit claim disproven) · `MFL-20260818-002` (report content-route rename `[id]`→`[scanId]`, untracked).

---

## Executive summary

Plan 64's foundation is almost entirely present (invites+roles, billing+plan limits, PDF/MD export, settings, public status page), but its "uitgangssituatie" contains one **false claim**: a seat limit already exists and is wired + tested (`invites-core.ts:62-87`; tests at `invites-core.test.ts:295-311,382-394`), so step 2 is a modification (member_limit → 409 + upsell, add Max plan + `seats`/`white_label` flags) rather than net-new. The three "missing" claims (branding tokens, workspaces, portal route) are confirmed; no `max` plan exists anywhere (DB constraint `003:8`, `planIdSchema` `plans.ts:3`, Stripe resolution `billing.ts:24-29`), branding is hardcoded in both renderers (`pdf.tsx:138,215`, `markdown.ts:46,124`), and the portal can mirror the public-status page's rate-limit/noindex/read-only-core pattern while reusing `generatePublicStatusSlug` and the per-string mask helpers. Report content API now lives at `apps/web/app/api/reports/[scanId]/content/route.ts` (untracked rename of the deleted `[id]/content`). Three plan open questions (seats-definition, per-scan vs per-site token, workspace roles) are not resolvable from code.

Report path: `C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-1\phase-1-survey-whole-plan-a3f1\report.md`
Audit path: `C:\Users\Yassin\Desktop\scanpal\ScanPal\DeepSeekAndDestroy\plans\64-team-seats-white-label--c9b2a1\runs\20260818T110500Z-opencode-7f2d\phases\phase-1\current-state-audit.md`
