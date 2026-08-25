import { describe, it, expect } from "vitest";
import {
  BAAS_SECURITY_LIMITS,
  buildBaasSecurityEvidence,
  evaluateConvexProbe,
  evaluateFirebaseProbe,
  evaluateSupabaseProbe,
  extractBaasFingerprints,
  type BaasFingerprint,
  type ConvexProbeResult,
  type FirebaseProbeResult,
  type SupabaseProbeResult,
} from "../baas-security";

function fp(platform: "supabase" | "firebase" | "convex", projectUrl: string): BaasFingerprint {
  return { platform, projectUrl, evidence: { project_url: projectUrl } };
}

describe("extractBaasFingerprints", () => {
  it("herkent een Supabase-project-URL in HTML", () => {
    const fps = extractBaasFingerprints(
      `<script>const c = createClient("https://abcdefgh.supabase.co", "key")</script>`,
    );
    const supa = fps.filter((f) => f.platform === "supabase");
    expect(supa).toHaveLength(1);
    expect(supa[0].projectUrl).toBe("https://abcdefgh.supabase.co");
  });

  it("herkent Supabase via supabaseUrl-config", () => {
    const fps = extractBaasFingerprints(
      `const supabaseUrl = "https://myproj.supabase.co";`,
    );
    expect(fps.some((f) => f.projectUrl === "https://myproj.supabase.co")).toBe(true);
  });

  it("maskeert Supabase anon- en service_role-keys in evidence", () => {
    const anon = "sb_publishable_" + "A".repeat(40);
    const secret = "sb_secret_" + "B".repeat(40);
    const fps = extractBaasFingerprints(
      `createClient("https://x.supabase.co", "${anon}"); const s = "${secret}";`,
    );
    const supa = fps.find((f) => f.platform === "supabase")!;
    expect(supa.evidence.anon_key).toBe("sb_p…AAAA");
    expect(supa.evidence.service_role_key).toBe("sb_s…BBBB");
    // Nooit de ruwe key in evidence.
    expect(JSON.stringify(supa.evidence)).not.toContain(anon);
    expect(JSON.stringify(supa.evidence)).not.toContain(secret);
  });

  it("herkent Firebase Realtime DB-URL + config (projectId/storageBucket/apiKey)", () => {
    const apiKey = "AIza" + "C".repeat(35);
    const html = `
      const firebaseConfig = {
        apiKey: "${apiKey}",
        projectId: "myapp",
        databaseURL: "https://myapp.firebaseio.com",
        storageBucket: "myapp.appspot.com",
      };
      firebase.initializeApp(firebaseConfig);
    `;
    const fps = extractBaasFingerprints(html);
    const fb = fps.find((f) => f.platform === "firebase")!;
    expect(fb.projectUrl).toBe("https://myapp.firebaseio.com");
    expect(fb.evidence.storage_bucket).toBe("https://myapp.appspot.com");
    expect(fb.evidence.api_key).toBe("AIza…CCCC");
    expect(JSON.stringify(fb.evidence)).not.toContain(apiKey);
  });

  it("herkent een Firebase storage-only bucket zonder RTDB-URL", () => {
    const fps = extractBaasFingerprints(`https://onlybucket.appspot.com/o`);
    const fb = fps.find((f) => f.platform === "firebase");
    expect(fb).toBeDefined();
    expect(fb!.projectUrl).toBe("https://onlybucket.appspot.com");
  });

  it("herkent Convex deployment-URL", () => {
    const fps = extractBaasFingerprints(
      `import { api } from "../convex/_generated/api"; const url = "https://happy-anon-123.convex.cloud";`,
    );
    const cvx = fps.find((f) => f.platform === "convex")!;
    expect(cvx.projectUrl).toBe("https://happy-anon-123.convex.cloud");
  });

  it("combineert HTML en scripts en dedupeert project-URL's", () => {
    const html = `<script src="/app.js"></script>`;
    const script = `fetch("https://dup.supabase.co/rest/v1/users"); fetch("https://dup.supabase.co/rest/v1/posts")`;
    const fps = extractBaasFingerprints(html, [script]);
    const supa = fps.filter((f) => f.platform === "supabase");
    expect(supa).toHaveLength(1);
  });

  it("geeft niets terug bij geen BaaS-platform", () => {
    expect(extractBaasFingerprints(`<html><body>gewone site</body></html>`)).toEqual([]);
  });

  it("herkent meerdere Supabase-projecten op één pagina", () => {
    const fps = extractBaasFingerprints(
      `https://proj-a.supabase.co https://proj-b.supabase.co`,
    );
    expect(fps.filter((f) => f.platform === "supabase")).toHaveLength(2);
  });

  it("werkt op echte esbuild-bundleroutput (mangled identifiers, brace-eliminatie)", () => {
    // Letterlijke `esbuild --bundle --minify --format=iife`-output van een snippet
    // met Supabase createClient + Firebase initializeApp (bron + commando: zie
    // __tests__/fixtures/baas-minified.md). esbuild mangelt de `firebaseConfig`-
    // identifier weg (`t={apiKey:...}`), dus detectie leunt op de string-literals
    // die de minificatie overleven — precies wat we in productie willen borgen.
    const minified = `(()=>{function i(a,e){return{url:a,key:e,from:p=>({t:p})}}var n={initializeApp(a){return{config:a,name:"[DEFAULT]"}}},s=i("https://min.supabase.co","sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd"),t={apiKey:"AIzaSyB1234567890abcdefghijklmnopqrstuv",authDomain:"minapp.firebaseapp.com",databaseURL:"https://minapp.firebaseio.com",projectId:"minapp",storageBucket:"minapp.appspot.com",messagingSenderId:"1234567890",appId:"1:1234567890:web:abcdef123456"},o=n.initializeApp(t);window.__app=o;window.__db=s.from("users");})();`;
    const fps = extractBaasFingerprints(minified);

    const supa = fps.find((f) => f.platform === "supabase");
    expect(supa?.projectUrl).toBe("https://min.supabase.co");
    expect(supa?.evidence.anon_key).toBeDefined();

    const fb = fps.find((f) => f.platform === "firebase");
    expect(fb?.projectUrl).toBe("https://minapp.firebaseio.com");
    expect(fb?.evidence.storage_bucket).toBe("https://minapp.appspot.com");
    expect(fb?.evidence.api_key).toBeDefined();
  });
});

describe("evaluateSupabaseProbe", () => {
  const f = fp("supabase", "https://x.supabase.co");

  it("high/fail bij publiek schema zonder key", () => {
    const probe: SupabaseProbeResult = {
      schema_public: true,
      tables_found: ["users", "posts"],
      anon_key_used: false,
      probed_urls: ["https://x.supabase.co"],
      not_probed_urls: [],
    };
    const ev = evaluateSupabaseProbe(f, probe);
    expect(ev.status).toBe("fail");
    expect(ev.severity).toBe("high");
    expect(ev.detail).toContain("tabelnamen lekken");
  });

  it("medium/warn bij schema opvraagbaar met anon-key", () => {
    const probe: SupabaseProbeResult = {
      schema_public: false,
      tables_found: ["users"],
      anon_key_used: true,
      probed_urls: ["https://x.supabase.co"],
      not_probed_urls: [],
    };
    const ev = evaluateSupabaseProbe(f, probe);
    expect(ev.status).toBe("warn");
    expect(ev.severity).toBe("medium");
  });

  it("info bij beschermd endpoint", () => {
    const probe: SupabaseProbeResult = {
      schema_public: false,
      tables_found: [],
      anon_key_used: false,
      probed_urls: ["https://x.supabase.co"],
      not_probed_urls: [],
    };
    const ev = evaluateSupabaseProbe(f, probe);
    expect(ev.status).toBe("info");
    expect(ev.severity).toBe("info");
  });

  it("info bij niet-geprobed (budget)", () => {
    const probe: SupabaseProbeResult = {
      schema_public: false,
      tables_found: [],
      anon_key_used: false,
      probed_urls: [],
      not_probed_urls: ["https://x.supabase.co"],
    };
    const ev = evaluateSupabaseProbe(f, probe);
    expect(ev.status).toBe("info");
    expect(ev.detail).toContain("niet geprobed");
  });
});

describe("evaluateFirebaseProbe", () => {
  const f = fp("firebase", "https://myapp.firebaseio.com");

  it("high/fail bij open Realtime DB", () => {
    const probe: FirebaseProbeResult = {
      rtdb_open: true,
      storage_open: false,
      rtdb_shallow_keys: ["users"],
      storage_items: null,
      probed_urls: ["https://myapp.firebaseio.com"],
      not_probed_urls: [],
    };
    const ev = evaluateFirebaseProbe(f, probe);
    expect(ev.status).toBe("fail");
    expect(ev.severity).toBe("high");
    expect(ev.detail).toContain("Realtime Database");
  });

  it("high/fail bij open Storage bucket", () => {
    const probe: FirebaseProbeResult = {
      rtdb_open: false,
      storage_open: true,
      rtdb_shallow_keys: null,
      storage_items: 42,
      probed_urls: ["https://myapp.firebaseio.com"],
      not_probed_urls: [],
    };
    const ev = evaluateFirebaseProbe(f, probe);
    expect(ev.status).toBe("fail");
    expect(ev.severity).toBe("high");
    expect(ev.detail).toContain("Storage");
  });

  it("info bij beschermd (API-key is publiek, geen bevinding)", () => {
    const probe: FirebaseProbeResult = {
      rtdb_open: false,
      storage_open: false,
      rtdb_shallow_keys: null,
      storage_items: null,
      probed_urls: ["https://myapp.firebaseio.com"],
      not_probed_urls: [],
    };
    const ev = evaluateFirebaseProbe(f, probe);
    expect(ev.status).toBe("info");
    expect(ev.severity).toBe("info");
    expect(ev.detail).toContain("publiek");
  });
});

describe("evaluateConvexProbe", () => {
  const f = fp("convex", "https://x.convex.cloud");

  it("low/warn bij publieke functies", () => {
    const probe: ConvexProbeResult = {
      functions_public: true,
      function_count: 5,
      probed_urls: ["https://x.convex.cloud"],
      not_probed_urls: [],
    };
    const ev = evaluateConvexProbe(f, probe);
    expect(ev.status).toBe("warn");
    expect(ev.severity).toBe("low");
  });

  it("info bij beschermd endpoint", () => {
    const probe: ConvexProbeResult = {
      functions_public: false,
      function_count: null,
      probed_urls: ["https://x.convex.cloud"],
      not_probed_urls: [],
    };
    const ev = evaluateConvexProbe(f, probe);
    expect(ev.status).toBe("info");
    expect(ev.severity).toBe("info");
  });
});

describe("buildBaasSecurityEvidence", () => {
  it("bouwt evidence met gemaskeerde config-keys en probe-summary", () => {
    const fingerprints: BaasFingerprint[] = [
      {
        platform: "supabase",
        projectUrl: "https://x.supabase.co",
        evidence: { project_url: "https://x.supabase.co", anon_key: "sb_p…abcd" },
      },
    ];
    const ev = buildBaasSecurityEvidence(
      "supabase",
      fingerprints,
      { performed: true, url: "https://x.supabase.co/rest/v1/", status: 200, summary: "ok" },
      false,
    );
    expect(ev.kind).toBe("baas-security");
    expect(ev.platform).toBe("supabase");
    expect(ev.fingerprints[0].project_url).toBe("https://x.supabase.co");
    expect(ev.fingerprints[0].config_keys).toEqual([{ type: "anon_key", masked: "sb_p…abcd" }]);
    expect(ev.probe.status).toBe(200);
    expect(ev.budget_exhausted).toBe(false);
  });
});

describe("BAAS_SECURITY_LIMITS", () => {
  it("heeft het globale probe-budget van 9 en per-platform cap van 3", () => {
    expect(BAAS_SECURITY_LIMITS.globalProbeBudget).toBe(9);
    expect(BAAS_SECURITY_LIMITS.maxProjectsPerPlatform).toBe(3);
  });
});
