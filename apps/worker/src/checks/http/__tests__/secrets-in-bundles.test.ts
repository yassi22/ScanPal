import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BUNDLE_SCAN_LIMITS } from "@scanpal/shared";
import { createSecretsInBundlesCheck } from "../secrets-in-bundles";
import type { CheckContext } from "../../types";

const STRIPE_SECRET = "sk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";
const STRIPE_PUBLISHABLE = "pk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/javascript" },
  });
}

function base64Map(sourcesContent: string[]): string {
  const map = JSON.stringify({ version: 3, sources: ["index.ts"], sourcesContent });
  return Buffer.from(map).toString("base64");
}

let routes: Map<string, Response>;

function stubFetch() {
  const fn = vi.fn(async (url: string) => {
    const res = routes.get(String(url));
    return res ?? new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function ctx(rateLimit = okRateLimit()): CheckContext {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
  };
}

function bundleEvidence(result: Awaited<ReturnType<ReturnType<typeof createSecretsInBundlesCheck>["run"]>>[0]) {
  return result.evidence as {
    kind: "bundle-secrets";
    matches: { key_type: string; provider: string; file: string; sourcemap: boolean; match_preview: string; severity: string }[];
    notes: string[];
  };
}

beforeEach(() => {
  routes = new Map();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secrets-in-bundles check (plan 53)", () => {
  it("scant script-src-bundels en toont de key alleen gemaskeerd", async () => {
    const fetch = stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/app.js"></script>`),
    );
    routes.set(
      "https://example.com/app.js",
      jsResponse(`const KEY = "${STRIPE_SECRET}";`),
    );
    const rate = okRateLimit();

    const results = await createSecretsInBundlesCheck(rate as never).run(ctx(rate));

    expect(results).toHaveLength(1);
    const finding = results[0];
    expect(finding.id).toBe("secrets-in-bundles");
    expect(finding.status).toBe("fail");
    expect(finding.severity).toBe("critical");

    const evidence = bundleEvidence(finding);
    expect(evidence.matches).toHaveLength(1);
    expect(evidence.matches[0]).toEqual({
      key_type: "stripe_secret_key",
      provider: "stripe",
      file: "https://example.com/app.js",
      sourcemap: false,
      match_preview: "sk_l…WxYz",
      severity: "critical",
    });
    // Nooit ongemaskeerd in evidence of detail.
    expect(JSON.stringify(evidence)).not.toContain(STRIPE_SECRET);
    expect(finding.detail).not.toContain(STRIPE_SECRET);
    // Per-host rate-limit geldt ook voor bundel-downloads.
    expect(rate).toHaveBeenCalledWith(
      "bundle-scan:example.com",
      BUNDLE_SCAN_LIMITS.downloadsPerHostPerMinute,
    );
    expect(fetch).toHaveBeenCalledWith("https://example.com/app.js", expect.any(Object));
  });

  it("resolveert een relatieve sibling-sourcemap en vindt keys in sourcesContent", async () => {
    const fetch = stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/assets/main.js"></script>`),
    );
    routes.set(
      "https://example.com/assets/main.js",
      jsResponse(`//# sourceMappingURL=main.js.map\nconst x = 1;`),
    );
    routes.set(
      "https://example.com/assets/main.js.map",
      jsResponse(
        JSON.stringify({
          version: 3,
          sources: ["index.ts"],
          sourcesContent: [`const SK = "${STRIPE_SECRET}";`],
        }),
      ),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const evidence = bundleEvidence(results[0]);
    expect(evidence.matches).toHaveLength(1);
    expect(evidence.matches[0]).toEqual(
      expect.objectContaining({
        file: "https://example.com/assets/main.js",
        sourcemap: true,
        match_preview: "sk_l…WxYz",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/assets/main.js.map",
      expect.any(Object),
    );
  });

  it("vindt keys via een inline base64-sourcemap (dedupe met de bundel)", async () => {
    stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/app.js"></script>`),
    );
    const inline =
      "//# sourceMappingURL=" +
      `data:application/json;base64,${base64Map([
        `const KEY = "${STRIPE_SECRET}";`,
      ])}`;
    routes.set(
      "https://example.com/app.js",
      jsResponse(`const KEY = "${STRIPE_SECRET}";\n${inline}`),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const evidence = bundleEvidence(results[0]);
    // Zelfde raw-waarde in bundel én sourcemap → 1 match (besluit 9); de
    // eerste vondst (de bundel zelf, niet de sourcemap) wint.
    expect(evidence.matches).toHaveLength(1);
    expect(evidence.matches[0].sourcemap).toBe(false);
  });

  it("sourcemap-404 → info-notitie, geen harde fout", async () => {
    stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/app.js"></script>`),
    );
    routes.set(
      "https://example.com/app.js",
      jsResponse(`//# sourceMappingURL=app.js.map`),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const finding = results[0];
    expect(finding.status).toBe("info");
    const evidence = bundleEvidence(finding);
    expect(evidence.matches).toHaveLength(0);
    expect(evidence.notes.join(" ")).toContain("Sourcemap niet gevonden (404)");
  });

  it("respecteert de 25-bundel-limiet en geeft een info-notitie voor het overschot", async () => {
    stubFetch();
    const scripts = Array.from(
      { length: BUNDLE_SCAN_LIMITS.maxBundles + 1 },
      (_, i) => `<script src="/js/${i}.js"></script>`,
    ).join("\n");
    routes.set("https://example.com/", htmlResponse(`<body>${scripts}</body>`));
    for (let i = 0; i < BUNDLE_SCAN_LIMITS.maxBundles + 1; i++) {
      routes.set(`https://example.com/js/${i}.js`, jsResponse(`console.log("ok");`));
    }

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const finding = results[0];
    expect(finding.status).toBe("info");
    expect(finding.detail).toContain("25 gescande bundel(s)");
    const evidence = bundleEvidence(finding);
    expect(evidence.notes.join(" ")).toContain(
      "1 bundel(s) overgeslagen (max 25).",
    );
  });

  it("een download > 5 MB → bundel overgeslagen + info-notitie", async () => {
    stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/big.js"></script>`),
    );
    routes.set(
      "https://example.com/big.js",
      jsResponse(`"${"a".repeat(BUNDLE_SCAN_LIMITS.maxBundleBytes + 1)}"`),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const evidence = bundleEvidence(results[0]);
    expect(evidence.matches).toHaveLength(0);
    expect(evidence.notes.join(" ")).toContain("Bundel niet gescand");
  });

  it("productie-keys scoren hoger dan anon/test-keys (status fail vs warn)", async () => {
    stubFetch();
    routes.set(
      "https://example.com/",
      htmlResponse(`<script src="/anon.js"></script>`),
    );
    routes.set(
      "https://example.com/anon.js",
      jsResponse(`const KEY = "${STRIPE_PUBLISHABLE}";`),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    const finding = results[0];
    expect(finding.status).toBe("warn");
    expect(finding.severity).toBe("low");
    const evidence = bundleEvidence(finding);
    expect(evidence.matches[0].key_type).toBe("stripe_publishable_key");
    expect(evidence.matches[0].match_preview).toBe("pk_l…WxYz");
  });

  it("geen HTML-pagina → info-finding (bundels niet controleerbaar)", async () => {
    stubFetch();
    routes.set(
      "https://example.com/",
      new Response("not html", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const results = await createSecretsInBundlesCheck(okRateLimit() as never).run(ctx());

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].detail).toContain("niet controleerbaar");
  });
});