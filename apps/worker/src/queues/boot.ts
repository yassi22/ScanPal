import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { FlowProducer, Queue, Worker } from "bullmq";
import type { NotifyInput } from "@scanpal/notify";
import { createRateLimiter } from "../rate-limit";
import { buildRegistry } from "../checks/registry";
import { createPlaywrightRunner } from "../checks/browser/playwright-runner";
import { createDispatcherProcessor } from "./dispatcher";
import { createCrawlProcessor } from "./crawl";
import { createAggregateProcessor, markScanFailed } from "./aggregate";
import { createScanProcessor } from "./scan-worker";
import { QUEUES, dlqName, queueOptions, queuePolicies } from "./index";

export type WorkerDeps = {
  db: Pool;
  redis: Redis;
  notify: (input: NotifyInput) => Promise<unknown> | unknown;
  log?: (line: string) => void;
  /**
   * Aantal routes dat de http-worker binnen één scan parallel verwerkt
   * (PROBE_MAX_CONCURRENCY). Default 1 (serieel) wanneer niet opgegeven.
   */
  routeConcurrency?: number;
  /** Plan 77: AES-GCM-sleutel voor het decrypten van het wegwerp-testaccount. */
  authCredentialKey?: string;
};

export type WorkerHandle = {
  close: () => Promise<void>;
};

/**
 * Boot alle scan-pipeline-consumers (plan 27, stap 4): dispatcher,
 * sub-jobs (http/browser/github) en aggregator + per-queue retry/timeout
 * (queuePolicies) + DLQ + partial-failure-policy (markScanFailed na exhausted
 * attempts van een sub-job of de aggregator).
 */
export function startScanWorkers(deps: WorkerDeps): WorkerHandle {
  const log = deps.log ?? (() => {});
  const connection = { connection: deps.redis };

  const rateLimiter = createRateLimiter(deps.redis);
  const browserRunner = createPlaywrightRunner();
  const registry = buildRegistry(rateLimiter, browserRunner, {
    redis: deps.redis,
    db: deps.db,
  });
  const flowProducer = new FlowProducer(connection);
  const crawlQueue = new Queue(QUEUES.crawl, { connection: deps.redis });

  const policies = queuePolicies;

  const dispatcherWorker = new Worker(
    QUEUES.dispatcher,
    createDispatcherProcessor(deps.db, crawlQueue, registry, log),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.dispatcher.lockDuration,
      ...queueOptions(policies.dispatcher),
    },
  );

  const crawlWorker = new Worker(
    QUEUES.crawl,
    createCrawlProcessor(deps.db, flowProducer, rateLimiter, log),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.crawl.lockDuration,
      ...queueOptions(policies.crawl),
    },
  );

  const httpWorker = new Worker(
    QUEUES.http,
    createScanProcessor(deps.db, registry.http, rateLimiter, {
      routeConcurrency: deps.routeConcurrency,
    }),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.http.lockDuration,
      ...queueOptions(policies.http),
    },
  );

  const browserWorker = new Worker(
    QUEUES.browser,
    createScanProcessor(deps.db, registry.browser, rateLimiter, {
      authCredentialKey: deps.authCredentialKey,
    }),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.browser.lockDuration,
      ...queueOptions(policies.browser),
    },
  );

  const githubWorker = new Worker(
    QUEUES.github,
    createScanProcessor(deps.db, registry.github, rateLimiter),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.github.lockDuration,
      ...queueOptions(policies.github),
    },
  );

  const aggregateWorker = new Worker(
    QUEUES.aggregate,
    createAggregateProcessor(deps.db, deps.notify, log),
    {
      ...connection,
      concurrency: 1,
      lockDuration: policies.aggregate.lockDuration,
      ...queueOptions(policies.aggregate),
    },
  );

  const workers = [
    { worker: dispatcherWorker, markScan: false },
    { worker: crawlWorker, markScan: true },
    { worker: httpWorker, markScan: true },
    { worker: browserWorker, markScan: true },
    { worker: githubWorker, markScan: true },
    { worker: aggregateWorker, markScan: true },
  ];

  const dlqQueues = new Map<string, Queue>();
  for (const queue of Object.values(QUEUES)) {
    dlqQueues.set(
      queue,
      new Queue(dlqName(queue), {
        connection: deps.redis,
      }),
    );
  }

  for (const { worker, markScan } of workers) {
    worker.on("failed", async (job, err) => {
      if (!job) return;
      if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

      const dlq = dlqQueues.get(job.queueName);
      if (dlq) {
        await dlq
          .add("failed", {
            queue: job.queueName,
            jobId: job.id,
            scanId: job.data?.scanId,
            error: err.message,
          })
          .catch((e) => log(`DLQ ${dlq.name} mislukt: ${String(e)}`));
      }

      if (markScan && job.data?.scanId) {
        try {
          await markScanFailed(deps.db, job.data.scanId, err.message);
        } catch (e) {
          log(`markScanFailed voor ${job.data.scanId} mislukt: ${String(e)}`);
        }
      }
    });
  }

  log(
    `scan-workers gestart: ${Object.values(QUEUES).join(", ")} ` +
      `+ DLQ (${[...dlqQueues.values()].map((q) => q.name).join(", ")})`,
  );

  return {
    async close() {
      await Promise.all(workers.map(({ worker }) => worker.close()));
      await flowProducer.close();
      await crawlQueue.close();
      await Promise.all([...dlqQueues.values()].map((q) => q.close()));
    },
  };
}