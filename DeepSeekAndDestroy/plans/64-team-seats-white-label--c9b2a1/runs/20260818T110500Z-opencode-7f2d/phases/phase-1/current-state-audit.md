# Current-State Audit — Plan 64 Team seats + client-workspaces + white-label

Phase: phase-1 · Role: Phase Surveyor (read-only) · Run: 20260818T110500Z-opencode-7f2d
Plan: docs/plans/64-team-seats-white-label.md (context only, not modified)

## Predicates (how a capability is classified)

- **PRESENT** — file/symbol exists on disk in the working tree (untracked files count as present).
- **WIRED** — reachable from runtime behavior: registered route (Next.js `app/api/**/route.ts`), exported function called through a live call path, or a schema re-exported from a package index.
- **REACHABLE** — present + wired but depends on external config (e.g. Stripe env) to take effect.
- **PARTIAL** — present + wired but incomplete against its own contract (e.g. seat-limit returns 400 with no upsell instead of 409+upsell).
- **MISSING** — predicate search over the stated boundary found nothing.
- **STALE** — a path/claim in the plan or docs no longer matches the current tree (git D rows, renamed routes, superseded claims).

## Search boundaries

- `apps/web/app`, `apps/web/lib`, `apps/web/components`, `packages/db`, `packages/shared`, `packages/scan-core`, `docs/plans/64-*`, `docs/FEATURES.md`, `docs/ROADMAP.md`.
- Greps: `white_label|white-label|whiteLabel`, `\bseats\b|seat_count|seat limit`, `branding|workspace|report_token|reportToken`, `mask|redact`, `randomBytes|randomUUID|generateToken`.

## Raw evidence (accumulated)

### DB layer (packages/db)
- Migrations dir: `packages/db/migrations/` — 25 files `001_…`..`025_scan_crux.sql`. Latest: `025_scan_crux.sql`. No down-files; rollback as SQL comments (e.g. `006_sites.sql:12-18`).
- Runner: `packages/db/src/migrate.ts` — `pnpm db:migrate`; reads `DATABASE_URL` from `apps/web/.env`; tracks applied files in `schema_migrations`; wraps each file in a transaction.
- `teams`: `id uuid pk gen_random_uuid()`, `name text not null`, `created_at` (001:17-21). **No `branding` column.**
- `memberships`: `(team_id, user_id)` PK, `role` check ('owner','member') default 'member', `status` check ('pending','accepted') default 'accepted', `invited_by`, `created_at`; index `memberships_user_id_idx` (001:23-33).
- `sites`: `id`, `team_id` FK cascade, `url`, `created_at`, unique `(team_id,url)` (001:35-41) + 006 adds `github_repo`, `label`, `last_scan_*`, `uptime_state`; 019 adds `public_status_slug` + partial unique index. **No `workspace_id`.**
- `scans`: `id`, `site_id` FK cascade, `status` check ('queued','running','completed','failed'), `progress`, `score`, `findings jsonb`, `created_at`, `completed_at` (001:43-52); 005 progress_details; 016 category_scores jsonb; 021 diff; 025 crux. **No `report_token`, no `expires_at`.**
- `subscriptions`: `team_id` PK, `plan` check **('free','pro')**, `status`, `current_period_end`, `credits_used`, stripe ids (003:4-14); 012 adds `cancel_at_period_end` + `interval` check ('month','year'). **No `max` plan value.**
- `api_keys`: has `expires_at` (nullable) — existing nullable-expiry pattern (src/index.ts:202-213).
- `invitations`: `expires_at timestamptz not null` (002:10) — token+expiry pattern; partial unique `invitations_pending_unique` on (team_id, lower(email)) where accepted_at is null (002:16-17); index `invitations_token_idx`.
- `reports`: id/team_id/site_id/scan_id/format ('md','pdf')/filename/content bytea/size_bytes/created_at; indexes `reports_team_created_idx`, `reports_site_idx` (015). **No token/expires_at columns.**
- RLS (024_rls_policies.sql): enables RLS on users, teams, memberships, subscriptions, api_keys, api_key_usage only. Select-policies via security-definer `public.is_team_member(target_team_id)` / `is_team_owner` (024:33-62). `auth.uid()` stub created if missing (024:16-29). **RLS NOT enabled on** sites, scans, reports, checks, invitations, uptime_*, threat_*.
- Index naming: `<table>_<cols>_idx`, unique uses `_key`; partial unique indexes used twice (`invitations_pending_unique`, `sites_public_status_slug_key`).
- Types: `packages/db/src/index.ts` — `*Row` types + const arrays (`userRoles`, `membershipStatuses`, `planIds = ["free","pro"]`, `subscriptionIntervals`, etc.). No ORM; `pg` Pool + raw SQL.
- `db/src/index.ts:6` `planIds = ["free","pro"]`; `:128` `SubscriptionRow.plan: (typeof planIds)[number]`.

### Shared contracts (packages/shared)
- `src/index.ts`: exports `userRoleSchema` (owner/member), `membershipStatusSchema`, `teamSchema`, `membershipSchema`, `inviteInputSchema` (email + role default member), `invitationSchema`, `teamMemberSchema`, `roleChangeSchema`; re-exports plans/api-keys/…/mcp-tools. A `brandingSchema`/`workspaceSchema`/`reportTokenSchema` does NOT exist.
- `src/plans.ts`: `planIdSchema = z.enum(["free","pro"])` (:3). `Plan` type has `maxMembers` (:22), `apiRatePerMinute`, `maxWebhooks`, `features: { uptime, github, activeTests, onDeploy }` (:27-34). Plans table: free maxMembers=3, pro maxMembers=10 (:43, :54). **No `seats` feature flag, no `white_label`, no `max` plan.**
- `src/report.ts`: `reportDataSchema` (scan/site/score/category_scores/summary/findings), `reportFormatSchema`, `reportMetaSchema`, `reportListQuerySchema`, cursor encode/decode. `findingSchema` used inside reportDataSchema.
- `src/scans.ts`: `scanTriggerSchema` = manual/schedule/deploy (:11), `scanSchema` includes progress_details/diff/crux.
- `src/public-status.ts`: `generatePublicStatusSlug()` (:51) — 16 hex chars from crypto.randomUUID; `isValidPublicStatusSlug` (:59) regex `^[0-9a-f]{12,32}$`; `PUBLIC_STATUS_SLUG_LENGTH = 16` (:45). Good template for reportTokenSchema helper.
- `src/bundle-secrets.ts:128` `maskSecret`; `src/sast-findings.ts:20` `maskMatch` — per-string masking helpers (4+4 rule, ≤8 → 1 char). No whole-finding redaction builder.

### Invite route (plan 02) — claim DISPROVEN
- POST invite: `apps/web/app/api/teams/[teamId]/invitations/route.ts` — `requireOwner` (:21), zod `inviteInputSchema` (:27), `createInvitation` (:36), error mapping: already_member/pending_exists → 409, everything else → 400 (:56-60). **`member_limit` → 400, NO upsell payload.**
- Accept: `apps/web/app/api/invitations/[token]/accept/route.ts` (:20) — session user, errors: not_found→404, expired→410, email_mismatch→403, else 400. GET: `apps/web/app/api/invitations/[token]/route.ts`.
- Invite listing: GET on `teams/[teamId]/invitations/route.ts` owner-only (:76). Member role mgmt: `teams/[teamId]/members/[userId]/route.ts` (updateMemberRole/removeMember); `members/route.ts` GET requireTeamMember.
- **Seat limit EXISTS and is WIRED + TESTED**: `apps/web/lib/invites-core.ts`
  - `generateToken()` :58 `randomBytes(32).toString("hex")`
  - `maxMembersForTeam()` :62-72 reads `subscriptions.plan`, returns `plans[planId].maxMembers`
  - `assertSeatAvailable()` :74-87 throws `InviteError("member_limit")` when `seats >= maxMembers`
  - called in `createInvitation` :117-129 (seats = accepted memberships + unexpired pending invites) and `acceptInvitation` :197-204 (seats = accepted memberships only)
  - `InviteErrorCode` includes `"member_limit"` (:15)
  - Tests: `apps/web/lib/__tests__/invites-core.test.ts:295-311` (blocks at free limit 3, allows >3 on pro) and `:382-394` (accept blocked at limit).
- Role model: owner/member both in memberships + invitations. Authz: `apps/web/lib/authz.ts` `requireTeamMember` (:26) / `requireOwner` (:40) — session-only, 401/403. API-key routes use `requireTeam` (`lib/api-auth.ts`).
- Upsell shape elsewhere: `{ error, upsell: { plan: "pro" } }` on 403 — `api/threats/route.ts:35`, `api/sites/[id]/schedule/route.ts:50`, `api/scans/route.ts:53` (+ extra `feature: "active_tests"`), etc. Clients read `data?.upsell` (components/sites-manager.tsx:171, scan-result.tsx:793, onboarding-wizard.tsx:32) and POST checkout body `{ planId: upsell?.plan ?? "pro" }`.

### Export renderer (plan 10)
- Routes: `apps/web/app/api/reports/[scanId]/route.ts` (generation, tracked), `apps/web/app/api/reports/route.ts` (history, tracked), `apps/web/app/api/reports/[scanId]/content/route.ts` (saved download, **untracked — renamed from `[id]/content`, git D**). Deleted path content verified via `git show HEAD:...` — identical logic, only param name changed (`id` → `scanId`), and the new route still passes it as `reportId` to `getReportContent` (store.ts:127-141). Tests updated: `apps/web/lib/__tests__/report-content-route.test.ts` imports the new path (6 lines diff).
- Renderer lib `apps/web/lib/report/`:
  - `data.ts` — `buildReportData(db, scanId, teamId)` (:42) team-scoped via `st.team_id = $2` (:53), `sortBySeverityCap` top-100/severity (:98), `reportFilename()` = `scanpal-{host}-{date}.{ext}` (:129-137).
  - `pdf.tsx` — `renderPdf` (:231) via `@react-pdf/renderer`; hardcodes **"ScanPal Report"** (:138) and **"Generated by ScanPal"** (:215). DejaVu font fallback (:30-45).
  - `markdown.ts` — `renderMarkdown` (:40); hardcodes **"# ScanPal Report"** (:46) and **"_Generated by ScanPal …_"** (:124).
  - `store.ts` — `saveReport` (:37), `listReports` keyset-paginated (:73), `getReportContent` (:127).
- Settings UI (plan 16/22): `apps/web/app/(dashboard)/settings/{profile,team,notifications,api-keys,webhooks}/page.tsx` server components + `apps/web/components/settings-nav.tsx` (LINKS array :6-12) + client panels (`components/team-settings.tsx`). Billing page: `apps/web/app/(dashboard)/billing/page.tsx` uses `getTeamUsage`/`getSubscriptionView`, `plans[usage.plan.id]`, `isPro` gate (:35), renders `BillingManager`/`Invoices`.

### Public status page (plan 57) — template for portal
- SSR page: `apps/web/app/(public)/status/[slug]/page.tsx` — `force-dynamic` (:14), `generateMetadata` robots `{ index:false, follow:false }` (:21-26), hardcoded "ScanPal" header link (:77-79) and footer (:152-155).
- JSON feed: `apps/web/app/api/public/status/[slug]/route.ts` — slug validation (:25), per-IP Redis rate limit `public:${ip}` 60/min fail-open (:34-52), `X-Robots-Tag: noindex, nofollow` (:76), cache headers (:73-75).
- Read-only data-builder: `apps/web/lib/public-status-core.ts` `getPublicStatus(db, slug)` (:172) — only uptime data, returns null → 404. Shared schema `packages/shared/src/public-status.ts`.
- `(public)` route group contains ONLY `status/[slug]/page.tsx` (no layout.tsx).
- Rate-limit helper: `apps/web/lib/rate-limit.ts` `checkRateLimit(key, limit, windowSeconds=60)` Redis fixed-window INCR+EXPIRE (:17-32). Redis singleton: `apps/web/lib/redis.ts`.
- No `app/robots.ts`. noindex mechanisms: generateMetadata robots + `X-Robots-Tag` header (`app/api/public/status/[slug]/route.ts:76`, `app/h/[token]/route.ts:22`).

### Billing / plan-feature lookup (feature 3)
- `packages/scan-core/src/credits.ts`: `getSubscriptionState` (:46), `getPlanForTeam` (:60, defaults free), `getTeamUsage` (:77), `spendCredit` (:122), `assertPlanFeature(db, teamId, "uptime"|"github"|"activeTests"|"onDeploy")` (:217). Re-exported by webapp via `apps/web/lib/credits.ts`.
- Feature checks in the wild: `apps/web/app/api/scans/route.ts:47-58` (`plan.features.activeTests` → 403+upsell), dashboard `plan?.features.uptime/github`, sites `plan.features.github/activeTests`, `sites/[id]/page.tsx:161` `onDeployEnabled`. `apps/web/app/api/plans/route.ts` serves `planList` via `publicPlanSchema`.
- Stripe: `apps/web/lib/billing.ts` — `resolvePlanFromPrice` maps price→"pro" only (:24-29); checkout uses `STRIPE_PRICE_PRO(_ANNUAL)` env (:44); `apps/web/lib/billing-core.ts` webhook sync hardcodes plan "pro" on checkout (:107) and resolves via `resolvePlanFromPrice` (:147). Env vars: `apps/web/lib/env.ts:17-19`.
- **No `max` plan** anywhere: db check constraint, planIdSchema, planList, Stripe env, pricing UI (`components/pricing-cards.tsx`, `app/(dashboard)/billing/page.tsx`).

### Tests (plan 6)
- Runner: root `pnpm test` → `pnpm --filter web test` → `vitest run`. Config `apps/web/vitest.config.ts`: node env, include `lib/**/*.test.ts`, alias `@` → app root.
- **No testcontainers / in-memory DB / docker.** Two patterns:
  1. Hand-rolled `fakePool()` returning canned query results (e.g. `apps/web/lib/__tests__/invites-core.test.ts:42-…`, `credits.test.ts`, `billing-core.test.ts`).
  2. `vi.mock("@/lib/db")` + `vi.mock("@/lib/api-auth")` + `vi.mock("server-only")` for route tests (e.g. `report-content-route.test.ts:7-10`, `public-status-route.test.ts`).
- Naming: `*-core.test.ts` (logic), `*-route.test.ts` (routes), fixtures file `report-fixtures.ts` (`makeFinding`, `makeRenderData`). Shared pkg tests live in `packages/shared/src/__tests__/`.
- Relevant existing tests: `invites-core.test.ts` (seat limit), `credits.test.ts`, `billing-core.test.ts`, `billing-routes.test.ts`, `report-data.test.ts`, `report-markdown.test.ts`, `report-pdf.test.ts`, `report-store.test.ts`, `reports-route.test.ts`, `report-content-route.test.ts`, `public-status-core.test.ts`, `public-status-route.test.ts`.

### Other token/secret helpers (reuse candidates)
- `generateToken()` invites-core.ts:58 (hex 32B), api-keys-core.ts:15 (base64url 32B, `sp_live_` prefix), threats-core.ts:328 (base64url), `generatePublicStatusSlug()` shared/public-status.ts:51.
- HMAC verify: `apps/web/lib/api-hmac.ts` (createHmac/timingSafeEqual), `apps/web/lib/deploy-webhooks.ts`.

### Plan claim verification
1. "Teams+memberships+rollen (2/plan02); billing+plan-limieten (3/plan03); export PDF/MD (9/21/plan10); settings (16) en abonnement-beheer (22) exist" — **CONFIRMED** (FEATURES.md 2✅,3✅,9✅,21✅,16✅,22✅; code above).
2. "Geen branding-tokens, workspaces of portaal-route" — **CONFIRMED MISSING** (grep `branding|workspace|report_token|white_label` across apps/packages → no code hits; `(public)` has only status page; `api/public` has only status).
3. "invite-route kent geen seat-limiet" — **DISPROVEN** (seat limit exists, wired, tested; currently 400 no-upsell).
4. Report content route: deleted `[id]/content`, new `[scanId]/content` (untracked) — **CONFIRMED**.
