import type { Pool, PoolClient } from "pg";
import type { NotifyInput } from "@scanpal/notify";
import type { ProbeResult } from "./probe";
import { transitionUptimeState } from "./state";
import { acquireLock, releaseLock, type LockClient } from "./lock";

export type UptimeSiteRow = {
  id: string;
  team_id: string;
  url: string;
  uptime_state: "up" | "down" | "unknown";
  uptime_state_changed_at: Date | null;
};

export type PollDeps = {
  db: Pool;
  redis: LockClient;
  probe: (url: string) => Promise<ProbeResult>;
  now?: Date;
  lockTtlSeconds?: number;
  log?: (line: string) => void;
  /** Notificatiehub (plan 13); wordt na de state-transitie aangeroepen. */
  notify?: (input: NotifyInput) => Promise<unknown> | unknown;
};

export type PollResult = {
  probed: string[];
  skippedLocked: string[];
  failed: string[];
};

const LOCK_KEY_PREFIX = "uptime:lock:";

/** Aantal opeenvolgende down-events vóór de laatste probe (na de laatste up). */
async function countTrailingFailures(
  client: PoolClient,
  siteId: string,
): Promise<number> {
  const result = await client.query(
    `select count(*)::int as n
     from uptime_events e
     where e.site_id = $1
       and e.status = 'down'
       and e.checked_at > coalesce(
         (select max(checked_at) from uptime_events where site_id = $1 and status = 'up'),
         to_timestamp(0))`,
    [siteId],
  );
  return result.rows[0].n as number;
}

export async function pollSite(
  deps: PollDeps,
  site: UptimeSiteRow,
  now: Date,
): Promise<void> {
  const result = await deps.probe(site.url);

  const client = await deps.db.connect();
  let transition: ReturnType<typeof transitionUptimeState> | null = null;
  try {
    await client.query("begin");

    const consecutiveFailures = await countTrailingFailures(client, site.id);
    transition = transitionUptimeState({
      previousState: site.uptime_state,
      consecutiveFailures,
      probeOk: result.ok,
    });

    await client.query(
      `insert into uptime_events (site_id, status, latency_ms, status_code, error)
       values ($1, $2, $3, $4, $5)`,
      [
        site.id,
        result.status,
        result.latency_ms,
        result.status_code,
        result.error,
      ],
    );

    if (transition.changed) {
      await client.query(
        `update sites
           set uptime_state = $2, uptime_state_changed_at = $3
         where id = $1`,
        [site.id, transition.state, now],
      );
    }

    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // transactie is mogelijk al beëindigd — negeren
    }
    throw err;
  } finally {
    client.release();
  }

  if (deps.notify && transition?.changed) {
    const incidentId =
      transition.state === "up" && site.uptime_state_changed_at
        ? site.uptime_state_changed_at.toISOString()
        : now.toISOString();
    try {
      await deps.notify({
        type: transition.state === "down" ? "site_down" : "site_recovered",
        teamId: site.team_id,
        entityId: site.id,
        incidentId,
        payload: { site_name: site.url },
      });
    } catch (err) {
      deps.log?.(`uptime-poller: notificatie voor site ${site.id} mislukt: ${String(err)}`);
    }
  }
}

/**
 * Eén poll-rondje: alle sites met monitoring aan ophalen, per site een
 * Redis-lock (EX 15) nemen zodat meerdere poller-instances nooit dezelfde
 * site tegelijk pollen, probe draaien, event + state-transitie schrijven.
 * De lock wordt altijd vrijgegeven (ook bij een mislukte probe).
 */
export async function pollAllSites(deps: PollDeps): Promise<PollResult> {
  const now = deps.now ?? new Date();
  const lockTtlSeconds = deps.lockTtlSeconds ?? 15;
  const log = deps.log ?? (() => {});
  const result: PollResult = { probed: [], skippedLocked: [], failed: [] };

  const sites = await deps.db.query<UptimeSiteRow>(
    "select id, team_id, url, uptime_state, uptime_state_changed_at from sites where uptime_enabled = true",
  );

  for (const site of sites.rows) {
    const lockKey = `${LOCK_KEY_PREFIX}${site.id}`;
    const token = await acquireLock(deps.redis, lockKey, lockTtlSeconds);
    if (!token) {
      result.skippedLocked.push(site.id);
      continue;
    }

    try {
      await pollSite(deps, site, now);
      result.probed.push(site.id);
    } catch (err) {
      result.failed.push(site.id);
      log(`uptime-poller: probe voor site ${site.id} mislukt: ${String(err)}`);
    } finally {
      await releaseLock(deps.redis, lockKey, token);
    }
  }

  return result;
}
