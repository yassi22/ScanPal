# packages/notify — AGENTS.md

Notificatiehub (plan 13): de enige plek die meldingen verstuurt — in-app rijen
in `notifications` + e-mail via Resend + outbound webhooks (plan 15) — met
per-user voorkeuren en dedup.

## Contract

- **`notify({ type, teamId, entityId, incidentId?, payload? })`** (via
  `createNotifier(deps)`): zoekt accepted teamleden + hun voorkeuren op,
  voert de dedup-check uit (unieke `dedup_key` in de DB), schrijft één
  `notifications`-rij per ontvanger en stuurt e-mail bij enabled; enabled
  webhooks van het team die dit event selecteren krijgen een outbox-rij in
  `webhook_deliveries` (status `pending`).
- **Dedup-key**: `{type}:{user_id}:{entityId}:{incidentId}` — site-down
  gebruikt `uptime_state_changed_at` als incident-id (1× per incident);
  scan-scoped types gebruiken de scan-id (1× per scan). Webhooks: unieke
  `dedup_key` op de delivery-rij (1× per event per webhook).
- **Defaults** (besluit plan 13): score-drop, site-down/-herstel, kritieke
  finding, credit-skip, scan-failed, webhook_disabled en payment_failed
  **aan**; scan_done **uit**. Ontbrekende voorkeurrij = default.
  Webhook-delivery is team-breed en volgt géén per-user voorkeuren.
  `payment_failed` (plan 16) wordt alleen door de Stripe-webhook-route
  aangeroepen (dedup per invoice-id).
- **Waarde-/drempelbeslissingen** (score-daling, kritiek) blijven bij de
  caller — dit pakket is dom van waarde, slim van bezorging.
- Type-schema's leven in `packages/shared` (`notifications.ts`); templates
  (titel/onderwerp/tekst/link per type) leven hier.
- **Webhook-deliverer** (`webhook-deliverer.ts`): `createWebhookDeliverer`
  pollt due `pending|failed`-rijen → SSRF-guard (incl. DNS) → HMAC-SHA256
  sign + `x-scanpal-*` headers → POST (10s timeout) → status-update;
  backoff 1m/5m/30m/2h, max 5 pogingen, daarna `disabled` +
  `notify(webhook_disabled)`; blijvende 4xx/ongeldige URL → `rejected`.
  Secrets: AES-256-GCM encrypt/decrypt (`webhook-secret.ts`), key
  `WEBHOOK_SECRET_KEY` (env). `webhook-security.ts`: `isBlockedIp`,
  `isUrlAllowed` (loopback/private-blocklist, dev-exceptie localhost).

## Rules

- Consumenten (scheduler, uptime-poller, webapp, later de dispatcher) roepen
  `notify` aan na hun eigen transactie; dit pakket schrijft buiten elke
  transactie van de caller.
- Retries zijn veilig: een tweede aanroep met dezelfde dedup-key doet niets.
- Geen secrets in logs; de e-mail-HTML escapt alle payload-tekst.
- Webhook-payloads ≤ 256 KB (`WEBHOOK_MAX_PAYLOAD_BYTES` in shared); de
  deliverer weigert grotere payloads bij bezorging.

## Commands

```bash
pnpm --filter notify typecheck
pnpm --filter notify test
```
