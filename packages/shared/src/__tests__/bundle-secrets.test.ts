import { describe, it, expect } from "vitest";
import {
  BUNDLE_SCAN_LIMITS,
  ENTROPY_THRESHOLD,
  bundleKeyTypeSchema,
  bundleProviderSchema,
  bundleProviderLabels,
  bundleSecretEvidenceSchema,
  bundleSecretMatchSchema,
  bundleSecretPatterns,
  classifySupabaseJwt,
  extractBundleSecrets,
  extractScriptSrc,
  maskSecret,
  parseSourceMappingComment,
  severityForBundleKeyType,
  shannonEntropy,
} from "../bundle-secrets";
import { checkCatalog } from "../check-catalog";
import { severityRank } from "../severity";

describe("bundle-secrets (plan 53)", () => {
  it("heeft de catalog-entry secrets-in-bundles (categorie http, passief)", () => {
    const entry = checkCatalog.find((c) => c.id === "secrets-in-bundles");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("http");
    expect(entry?.active).toBe(false);
  });

  it("heeft de geplande limieten (25 bundels / 5 MB per bundel)", () => {
    expect(BUNDLE_SCAN_LIMITS.maxBundles).toBe(25);
    expect(BUNDLE_SCAN_LIMITS.maxBundleBytes).toBe(5 * 1024 * 1024);
    expect(BUNDLE_SCAN_LIMITS.downloadTimeoutMs).toBeGreaterThan(0);
  });

  it("maskert nooit meer dan 4+4 tekens zichtbaar", () => {
    expect(maskSecret("sk_live_1234567890abcdef")).toBe("sk_l…cdef");
    expect(maskSecret("sk_live_1234567890abcdef").replace("…", "").length).toBe(8);
    expect(maskSecret("kort")).toBe("k…");
    expect(maskSecret("").length).toBe(0);
  });

  it("berekent Shannon-entropie en de drempel is gecalibreerd", () => {
    expect(shannonEntropy("aaaaaa")).toBe(0);
    expect(shannonEntropy("sk_live_1234567890abcdef")).toBeGreaterThan(ENTROPY_THRESHOLD);
    expect(ENTROPY_THRESHOLD).toBeGreaterThan(0);
  });

  it("heeft per provider een werkend patroon (stripe, openai, supabase, firebase, github, aws)", () => {
    const samples: { text: string; keyType: string }[] = [
      { text: "const key = 'sk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz'", keyType: "stripe_secret_key" },
      { text: "sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz", keyType: "stripe_test_secret_key" },
      { text: "pk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz", keyType: "stripe_publishable_key" },
      { text: "rk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz", keyType: "stripe_restricted_key" },
      { text: "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk", keyType: "openai_api_key" },
      { text: "sk-abcdefghijklmnopqrstuvwxyz", keyType: "openai_api_key" },
      { text: "sb_secret_abcdefghijklmnopqrstuvwxyz123456", keyType: "supabase_service_role" },
      { text: "sb_publishable_abcdefghijklmnopqrstuvwxyz123", keyType: "supabase_anon_key" },
      { text: "AIzaSyA1234567890abcdefghijklmnopqrstuv", keyType: "google_api_key" },
      { text: "ghp_1234567890abcdefghijklmnopqrstuvwxyz", keyType: "github_token" },
      { text: "AKIAIOSFODNN7EXAMPLE", keyType: "aws_access_key_id" },
      { text: "xoxb-123456789012-1234567890123-abcdefghij", keyType: "slack_token" },
      { text: "SG.abcdefghijklmnopqrstuvwxyz.ABCDEFGHIJKLMNOPQRSTUVWXYZ", keyType: "sendgrid_api_key" },
      { text: "SK0123456789abcdef0123456789abcdef", keyType: "twilio_api_key" },
      { text: "pk.eyJ1IjoiZXhhbXBsZSIsImEiOiJjbHQifQ.abcdefghijklmnopqrstuvwxyz", keyType: "mapbox_public_token" },
      { text: "npm_abcdefghijklmnopqrstuvwxyz1234567890", keyType: "npm_token" },
      { text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----", keyType: "private_key" },
    ];
    for (const sample of samples) {
      const found = extractBundleSecrets(sample.text);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].key_type).toBe(sample.keyType);
    }
  });

  it("vindt generieke tokens alleen met hoge entropie (weinig false positives)", () => {
    const lowEntropy = 'apiKey = "aaaaaaaaaaaaaaaaaaaaaaaa"';
    const highEntropy = 'apiKey = "x7f2k9Qz1pLm8nVb3cRt6YuW"';
    expect(extractBundleSecrets(lowEntropy)).toHaveLength(0);
    const found = extractBundleSecrets(highEntropy);
    expect(found.length).toBe(1);
    expect(found[0].key_type).toBe("generic_token");
  });

  it("classificeert supabase-JWT: anon vs service-role", () => {
    const anonJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15cHJvamVjdCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAwMDB9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const serviceJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15cHJvamVjdCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDAwMH0.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`;
    const foundAnon = extractBundleSecrets(anonJwt);
    const foundService = extractBundleSecrets(serviceJwt);
    expect(foundAnon[0].key_type).toBe("supabase_anon_key");
    expect(foundService[0].key_type).toBe("supabase_service_role");
    expect(classifySupabaseJwt("geen-jwt")).toBeNull();
    // generieke JWT zonder supabase-marker wordt niet als key gevlagd
    const genericJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`;
    expect(extractBundleSecrets(genericJwt)).toHaveLength(0);
  });

  it("productie-keys scoren hoger dan test/anon-keys", () => {
    expect(severityForBundleKeyType("stripe_secret_key")).toBe("critical");
    expect(severityForBundleKeyType("stripe_publishable_key")).toBe("low");
    expect(severityForBundleKeyType("supabase_service_role")).toBe("critical");
    expect(severityForBundleKeyType("supabase_anon_key")).toBe("low");
    expect(severityForBundleKeyType("openai_api_key")).toBe("critical");
    expect(severityForBundleKeyType("aws_access_key_id")).toBe("high");
    expect(
      severityRank[severityForBundleKeyType("stripe_secret_key")],
    ).toBeGreaterThan(severityRank[severityForBundleKeyType("stripe_publishable_key")]);
  });

  it("valideert het finding-detail contract", () => {
    const match = {
      key_type: "stripe_secret_key",
      provider: "stripe",
      file: "https://example.com/_next/static/chunks/app.js",
      sourcemap: false,
      match_preview: "sk_l…cdef",
      severity: "critical",
    };
    expect(bundleSecretMatchSchema.safeParse(match).success).toBe(true);
    expect(
      bundleSecretMatchSchema.safeParse({ ...match, severity: "onbekend" }).success,
    ).toBe(false);
    expect(bundleKeyTypeSchema.safeParse("stripe_secret_key").success).toBe(true);
    expect(bundleProviderSchema.safeParse("stripe").success).toBe(true);
  });

  it("valideert het bundel-evidence met notes (sourcemap-404, overgeslagen bundels)", () => {
    const evidence = {
      kind: "bundle-secrets",
      matches: [
        {
          key_type: "stripe_secret_key",
          provider: "stripe",
          file: "https://example.com/app.js",
          sourcemap: true,
          match_preview: "sk_l…cdef",
          severity: "critical",
        },
      ],
      notes: ["sourcemap niet gevonden voor https://example.com/app.js.map"],
    };
    const parsed = bundleSecretEvidenceSchema.safeParse(evidence);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("evidence moet valideren");
    expect(parsed.data.notes).toHaveLength(1);
  });

  it("lost sourcemap-comments op (url en inline base64)", () => {
    const urlRef = parseSourceMappingComment(
      "//# sourceMappingURL=app.js.map",
    );
    expect(urlRef).toEqual({ kind: "url", url: "app.js.map" });

    const inline = parseSourceMappingComment(
      "//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==",
    );
    expect(inline?.kind).toBe("inline");
    if (inline && inline.kind === "inline") {
      expect(inline.base64).toBe(true);
      expect(inline.payload).toBe("eyJ2ZXJzaW9uIjozfQ==");
    }
    expect(parseSourceMappingComment("// geen map")).toBeNull();
  });

  it("extraheert script src-URL's uit HTML, relatief én absoluut", () => {
    const html = `
      <script src="/js/app.js"></script>
      <script src="https://cdn.example.com/lib.js"></script>
      <script>console.log("inline")</script>
    `;
    const urls = extractScriptSrc(html, "https://example.com/page");
    expect(urls).toEqual([
      "https://example.com/js/app.js",
      "https://cdn.example.com/lib.js",
    ]);
  });

  it("heeft een label per provider en key_type voor de UI-badges", () => {
    expect(bundleProviderLabels.stripe).toBe("Stripe");
    for (const provider of bundleProviderSchema.options) {
      expect(bundleProviderLabels[provider]).toBeDefined();
    }
  });

  it("heeft een label en provider per patroon (UI-badges)", () => {
    expect(bundleProviderLabels.stripe).toBe("Stripe");
    for (const pattern of bundleSecretPatterns) {
      expect(pattern.label.trim().length).toBeGreaterThan(0);
      expect(bundleProviderLabels[pattern.provider]).toBeDefined();
    }
  });
});