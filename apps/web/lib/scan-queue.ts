import "server-only";

import {
  createScanDispatcherQueue,
  enqueueScanDispatcher,
  type Queue,
} from "@scanpal/scan-core";
import { env } from "./env";

let queue: Queue | null = null;

/**
 * Enqueue `scan.dispatcher` met `jobId = scanId` (plan 27, besluit 7): de
 * webapp voert nooit scans inline uit. De queue-instance is een lazy
 * singleton zodat route-handlers geen per-request verbinding opzetten.
 */
export async function enqueueScan(scanId: string): Promise<void> {
  if (!queue) {
    queue = createScanDispatcherQueue(env.redisUrl);
  }
  await enqueueScanDispatcher(queue, scanId);
}