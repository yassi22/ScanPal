import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScanProgressController } from "../scan-progress-client";

type EventHandler = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, EventHandler[]>();
  onerror: ((e: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: EventHandler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

const SCAN_ID = "00000000-0000-4000-8000-000000000001";

const PROGRESS_EVENT = {
  event: "progress",
  scan_id: SCAN_ID,
  status: "running",
  progress: {
    overall: 50,
    checks_done: 2,
    checks_total: 4,
    categories: {
      http: {
        status: "running",
        done: 2,
        total: 3,
        percent: 67,
        current_check: "Security headers",
      },
      seo: { status: "pending", done: 0, total: 1, percent: 0, current_check: null },
      aeo: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
      github: { status: "pending", done: 0, total: 0, percent: 0, current_check: null },
    },
  },
};

const RUNNING_RESPONSE = {
  id: SCAN_ID,
  site_id: "site-1",
  status: "running",
  progress: 25,
  progress_details: null,
  score: null,
  findings: {},
  summary: null,
  error: null,
  completed_at: null,
};

describe("createScanProgressController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(fetchJson?: (url: string) => Promise<unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const controller = createScanProgressController({
      scanId: SCAN_ID,
      onUpdate: (patch) => updates.push(patch),
      eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
      fetchJson:
        fetchJson ??
        (async () => ({
          ...RUNNING_RESPONSE,
          status: "completed",
          progress: 100,
          score: 88,
          findings: { checks: [{ id: "reachability", status: "pass" }] },
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 1 },
          completed_at: "2026-08-15T09:01:00.000Z",
        })),
    });
    controller.start();
    const es = MockEventSource.instances[0];
    return { controller, es, updates };
  }

  it("verwerkt progress-events via de EventSource", () => {
    const { es, updates } = setup();

    es.emit("progress", PROGRESS_EVENT);

    expect(updates[0]).toMatchObject({
      status: "running",
      progress: 50,
    });
    expect(updates[0].progressDetails).toMatchObject({
      checks_done: 2,
      checks_total: 4,
    });
  });

  it("negeert ongeldige events zonder te crashen", () => {
    const { es, updates } = setup();

    es.emit("progress", { event: "progress", garbage: true });

    expect(updates).toHaveLength(0);
  });

  it("pakt bij completed de volledige resultaten op en stopt", async () => {
    const { es, updates } = setup();

    es.emit("completed", {
      event: "completed",
      scan_id: SCAN_ID,
      status: "completed",
      score: 88,
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 1 },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(updates[0]).toMatchObject({ status: "completed", score: 88 });
    expect(updates[1]).toMatchObject({
      status: "completed",
      findings: { checks: [{ id: "reachability", status: "pass" }] },
    });
    expect(es.closed).toBe(true);
  });

  it("toont bij failed de foutmelding en stopt", async () => {
    const { es, updates } = setup();

    es.emit("failed", {
      event: "failed",
      scan_id: SCAN_ID,
      status: "failed",
      error: "netwerkfout",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(updates[0]).toMatchObject({ status: "failed", error: "netwerkfout" });
    expect(es.closed).toBe(true);
  });

  it("behandelt canceled als terminale eindstaat en stopt", async () => {
    const { es, updates } = setup();

    es.emit("canceled", {
      event: "canceled",
      scan_id: SCAN_ID,
      status: "canceled",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(updates[0]).toMatchObject({ status: "canceled" });
    expect(es.closed).toBe(true);
  });

  it("valt bij een EventSource-fout terug op polling tot terminal", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce(RUNNING_RESPONSE)
      .mockResolvedValueOnce(RUNNING_RESPONSE)
      .mockResolvedValueOnce({
        ...RUNNING_RESPONSE,
        status: "completed",
        score: 91,
      });
    const { es, updates } = setup(fetchJson);

    es.fail();
    expect(es.closed).toBe(true);
    expect(fetchJson).toHaveBeenCalledWith(`/api/scans/${SCAN_ID}`);

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(updates).toContainEqual(expect.objectContaining({ progress: 25 }));

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "completed", score: 91 }),
    );

    const calls = fetchJson.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchJson).toHaveBeenCalledTimes(calls);
  });

  it("blijft pollen zolang de scan niet terminal is", async () => {
    const fetchJson = vi.fn().mockResolvedValue(RUNNING_RESPONSE);
    const { es } = setup(fetchJson);

    es.fail();
    await vi.advanceTimersByTimeAsync(9000);

    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it("stopt opruimend (geen polling meer na stop)", async () => {
    const fetchJson = vi.fn().mockResolvedValue(RUNNING_RESPONSE);
    const { es, controller } = setup(fetchJson);

    controller.stop();
    es.fail();
    await vi.advanceTimersByTimeAsync(9000);

    expect(fetchJson).not.toHaveBeenCalled();
  });
});
