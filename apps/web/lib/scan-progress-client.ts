import {
  scanProgressEventSchema,
  type ProgressDetails,
  type SeverityCounts,
} from "@scanpal/shared";

export type ScanViewState = {
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: number;
  progressDetails: ProgressDetails | null;
  score: number | null;
  findings: Record<string, unknown>;
  summary: SeverityCounts | null;
  error: string | null;
  /** Plan 54: aantal ontdekte routes (route-teller tijdens de scan). */
  routeCount: number | null;
  completedAt: string | null;
};

export type ScanProgressUpdate = Partial<ScanViewState>;

export type ScanProgressControllerOptions = {
  scanId: string;
  onUpdate: (patch: ScanProgressUpdate) => void;
  eventSourceFactory?: (url: string) => EventSource;
  fetchJson?: (url: string) => Promise<unknown>;
  pollIntervalMs?: number;
};

type ScanResponse = {
  status: string;
  progress: number;
  progress_details: ProgressDetails | null;
  score: number | null;
  findings: Record<string, unknown>;
  summary: SeverityCounts | null;
  error: string | null;
  route_count?: number | null;
  completed_at: string | null;
};

/**
 * Client-side progress-feed: EventSource op GET /api/scans/[id]/stream met
 * poll-fallback op GET /api/scans/[id] (elke 3s) zodra de verbinding faalt of
 * sluit vóór een terminale status. Bij een terminale status wordt één laatste
 * GET gedaan voor de volledige resultaten (findings/summary).
 */

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "canceled"
  );
}
export function createScanProgressController(
  options: ScanProgressControllerOptions,
) {
  const { scanId, onUpdate } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const eventSourceFactory =
    options.eventSourceFactory ?? ((url: string) => new EventSource(url));
  const fetchJson =
    options.fetchJson ??
    (async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} mislukt (${res.status})`);
      return res.json();
    });

  let eventSource: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let terminal = false;
  let stopped = false;

  function mapScanResponse(data: unknown): ScanProgressUpdate {
    const d = (data ?? {}) as Partial<ScanResponse>;
    return {
      status: (d.status as ScanViewState["status"]) ?? "queued",
      progress: d.progress ?? 0,
      progressDetails: d.progress_details ?? null,
      score: d.score ?? null,
      findings: d.findings ?? {},
      summary: d.summary ?? null,
      error: d.error ?? null,
      routeCount: d.route_count ?? null,
      completedAt: d.completed_at ?? null,
    };
  }

  async function loadFull(): Promise<ScanResponse | null> {
    try {
      const data = await fetchJson(`/api/scans/${scanId}`);
      return data as ScanResponse;
    } catch {
      return null;
    }
  }

  function stop() {
    stopped = true;
    eventSource?.close();
    eventSource = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function handleEvent(payload: unknown) {
    const parsed = scanProgressEventSchema.safeParse(payload);
    if (!parsed.success) return;
    const event = parsed.data;

    if (event.event === "progress") {
      onUpdate({
        status: event.status,
        progress: event.progress.overall,
        progressDetails: {
          categories: event.progress.categories,
          checks_done: event.progress.checks_done,
          checks_total: event.progress.checks_total,
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    terminal = true;
    if (event.event === "completed") {
      onUpdate({ status: "completed", score: event.score, summary: event.summary });
      void loadFull().then((data) => {
        if (data?.status === "completed") onUpdate(mapScanResponse(data));
        stop();
      });
    } else if (event.event === "canceled") {
      onUpdate({ status: "canceled" });
      void loadFull().then((data) => {
        if (data?.status === "canceled") onUpdate(mapScanResponse(data));
        stop();
      });
    } else {
      onUpdate({ status: "failed", error: event.error });
      void loadFull().then((data) => {
        if (data?.status === "failed") onUpdate(mapScanResponse(data));
        stop();
      });
    }
  }

  function startPolling() {
    if (stopped || terminal || pollTimer) return;
    void loadFull().then((data) => {
      if (stopped) return;
      if (isTerminalStatus(data?.status)) {
        terminal = true;
        onUpdate(mapScanResponse(data));
        stop();
      }
    });
    pollTimer = setInterval(() => {
      void loadFull().then((data) => {
        if (stopped) return;
        if (isTerminalStatus(data?.status)) {
          terminal = true;
          onUpdate(mapScanResponse(data));
          stop();
        } else if (data) {
          onUpdate(mapScanResponse(data));
        }
      });
    }, pollIntervalMs);
  }

  function connect() {
    if (stopped || terminal) return;
    const es = eventSourceFactory(`/api/scans/${scanId}/stream`);
    eventSource = es;

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        handleEvent(JSON.parse(String(e.data)));
      } catch {
        // ongeldig event negeren
      }
    });
    es.addEventListener("completed", (e: MessageEvent) => {
      try {
        handleEvent(JSON.parse(String(e.data)));
      } catch {
        // ongeldig event negeren
      }
    });
    es.addEventListener("failed", (e: MessageEvent) => {
      try {
        handleEvent(JSON.parse(String(e.data)));
      } catch {
        // ongeldig event negeren
      }
    });
    es.addEventListener("canceled", (e: MessageEvent) => {
      try {
        handleEvent(JSON.parse(String(e.data)));
      } catch {
        // ongeldig event negeren
      }
    });

    es.onerror = () => {
      es.close();
      eventSource = null;
      if (!terminal) startPolling();
    };
  }

  return {
    start() {
      connect();
    },
    stop,
  };
}
