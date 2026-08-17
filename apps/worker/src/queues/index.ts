import type { QueueOptions } from "bullmq";

/**
 * Queue-contract (plan 27): alle scan-queues + per-queue retry/timeout-policy
 * (besluit 6). De dispatcher fanned uit naar de sub-jobs; de aggregator draait
 * pas als alle children compleet zijn (FlowProducer-semantiek).
 */
export const QUEUES = {
  dispatcher: "scan.dispatcher",
  crawl: "scan.crawl",
  aggregate: "scan.aggregate",
  http: "scan.http",
  browser: "scan.browser",
  github: "scan.github",
} as const;

export type ScanQueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job-data-contract voor alle scan-jobs. */
export type ScanJobData = { scanId: string };

/** DLQ per queue (na exhausted attempts). */
export function dlqName(queue: string): string {
  return `dlq.${queue}`;
}

type QueuePolicy = {
  queue: string;
  attempts: number;
  backoff?: { type: "exponential"; delay: number; multiplier: number };
  lockDuration: number;
};

export const queuePolicies: Record<keyof typeof QUEUES, QueuePolicy> = {
  dispatcher: { queue: QUEUES.dispatcher, attempts: 1, lockDuration: 30_000 },
  crawl: {
    queue: QUEUES.crawl,
    attempts: 2,
    backoff: { type: "exponential", delay: 5_000, multiplier: 2 },
    lockDuration: 120_000,
  },
  aggregate: { queue: QUEUES.aggregate, attempts: 3, lockDuration: 60_000 },
  http: {
    queue: QUEUES.http,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000, multiplier: 3 },
    lockDuration: 120_000,
  },
  browser: {
    queue: QUEUES.browser,
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000, multiplier: 3 },
    lockDuration: 300_000,
  },
  github: {
    queue: QUEUES.github,
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000, multiplier: 2 },
    lockDuration: 600_000,
  },
};

export function queueOptions(policy: QueuePolicy): Pick<
  QueueOptions,
  "defaultJobOptions"
> {
  return {
    defaultJobOptions: {
      attempts: policy.attempts,
      backoff: policy.backoff,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  };
}