import { canonicalizeSiteUrl } from "@scanpal/shared";

export type ProbeResult = {
  ok: boolean;
  status: "up" | "down";
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
};

export type ProbeOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
};

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_USER_AGENT = "ScanPal/0.1 (+https://scanpal.dev)";

type Attempt = {
  ok: boolean;
  latencyMs: number;
  statusCode: number | null;
  error: string | null;
};

/**
 * Beperkte globale concurrency (per-host politeness): nooit meer dan
 * `max` probes tegelijk.
 */
export class ConcurrencyGate {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export const globalProbeGate = new ConcurrencyGate(10);

function classifyError(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause as
    | { code?: string; message?: string }
    | undefined;
  const name = (err as { name?: string }).name;
  const code = cause?.code ?? "";
  const message = cause?.message ?? (err as Error).message;

  if (name === "AbortError" || code === "UND_ERR_ABORTED") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (
    code.startsWith("ERR_TLS") ||
    code === "ECONNRESET" ||
    message.toLowerCase().includes("tls") ||
    message.toLowerCase().includes("certificate")
  ) {
    return "tls";
  }
  if (
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  ) {
    return "connect";
  }
  return "network";
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function probeOnce(
  url: string,
  options: Required<ProbeOptions>,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const start = performance.now();

  try {
    let current = url;
    let redirects = 0;

    for (;;) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": options.userAgent },
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location || ++redirects > options.maxRedirects) {
          return {
            ok: false,
            latencyMs: Math.round(performance.now() - start),
            statusCode: response.status,
            error: "too-many-redirects",
          };
        }
        current = new URL(location, current).toString();
        continue;
      }

      return {
        ok: response.status < 500,
        latencyMs: Math.round(performance.now() - start),
        statusCode: response.status,
        error: response.status >= 500 ? "http-5xx" : null,
      };
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      statusCode: null,
      error: classifyError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP-probe op de canonieke https-URL (plan 11): timeout 10s, max 5
 * redirects, `< 500` = up. Bij connect/TLS-fout op https één http-fallback;
 * de beste poging telt.
 */
export async function probeUrl(
  rawUrl: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const canonical = canonicalizeSiteUrl(rawUrl);
  if (!canonical) {
    return {
      ok: false,
      status: "down",
      latency_ms: null,
      status_code: null,
      error: "invalid-url",
    };
  }

  const opts: Required<ProbeOptions> = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
  };

  const httpsUrl = `https://${canonical}`;
  const httpsAttempt = await probeOnce(httpsUrl, opts);

  const needsFallback = !httpsAttempt.ok && !httpsAttempt.statusCode && (
    httpsAttempt.error === "connect" || httpsAttempt.error === "tls"
  );

  if (needsFallback) {
    const httpAttempt = await probeOnce(
      httpsUrl.replace(/^https:/, "http:"),
      opts,
    );
    if (httpAttempt.ok) {
      return {
        ok: true,
        status: "up",
        latency_ms: httpAttempt.latencyMs,
        status_code: httpAttempt.statusCode,
        error: null,
      };
    }
  }

  return {
    ok: httpsAttempt.ok,
    status: httpsAttempt.ok ? "up" : "down",
    latency_ms: httpsAttempt.ok ? httpsAttempt.latencyMs : null,
    status_code: httpsAttempt.statusCode,
    error: httpsAttempt.error,
  };
}
