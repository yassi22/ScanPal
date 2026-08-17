import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type { Queue } from "bullmq";

/**
 * Queue-aanroep vanuit de webapp en scheduler (plan 27, besluit 7): enqueue
 * `scan.dispatcher` met `jobId = scanId` (idempotent — een tweede enqueue
 * met dezelfde id maakt geen dubbele job). De dispatcher zelf fanned uit via
 * de FlowProducer in de worker.
 */
export const SCAN_DISPATCHER_QUEUE = "scan.dispatcher";
export const SCAN_CRAWL_QUEUE = "scan.crawl";

export function createScanDispatcherQueue(redisUrl: string): Queue {
  return new Queue(SCAN_DISPATCHER_QUEUE, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });
}

export function createScanCrawlQueue(redisUrl: string): Queue {
  return new Queue(SCAN_CRAWL_QUEUE, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });
}

export async function enqueueScanDispatcher(
  queue: Queue,
  scanId: string,
): Promise<void> {
  await queue.add("scan", { scanId }, { jobId: scanId });
}

/**
 * Plan 54: de dispatcher enqueuet `scan.crawl` (jobId = scanId, idempotent).
 * De crawler ontdekt routes en maakt pas daarna de fan-out-flow aan
 * (aggregate + http/browser/github) — de checks draaien dus op de volledige
 * route-lijst. Bij een her-enqueue (re-run) is de job al verwijderd na
 * voltooiing en draait hij opnieuw; routes worden idempotent overschreven.
 */
export async function enqueueScanCrawl(
  queue: Queue,
  scanId: string,
): Promise<void> {
  await queue.add("crawl", { scanId }, { jobId: scanId });
}