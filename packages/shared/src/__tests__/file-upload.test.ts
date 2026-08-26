import { describe, it, expect } from "vitest";
import {
  UPLOAD_CHECK_IDS,
  UPLOAD_PROBES,
  UPLOAD_SIZE_PROBE_BYTES,
  buildProbeBody,
  classifyUploadOutcome,
  makeCanaryToken,
  outputDiffersFromSource,
} from "../file-upload";

// Strings die op echte webshell-/exploit-code wijzen — mogen NOOIT in een
// probe-body voorkomen (plan besluit 1: canary-payloads zijn altijd inert).
const WEBSHELL_MARKERS = [
  "system(",
  "exec(",
  "shell_exec",
  "passthru",
  "eval(",
  "base64_decode",
  "$_get",
  "$_post",
  "$_request",
  "cmd.exe",
  "/bin/sh",
  "wget ",
  "curl ",
];

describe("UPLOAD_CHECK_IDS", () => {
  it("bevat precies de vijf upload-*-ids, in de gespecificeerde volgorde", () => {
    expect(UPLOAD_CHECK_IDS).toEqual([
      "upload-unrestricted-type",
      "upload-executable",
      "upload-content-sniff",
      "upload-size-limit",
      "upload-path-traversal",
    ]);
  });
});

describe("UPLOAD_PROBES", () => {
  it("bevat precies vijf probes", () => {
    expect(UPLOAD_PROBES).toHaveLength(5);
  });

  it("elke probe heeft een geldig id, filename, content_type en description", () => {
    for (const probe of UPLOAD_PROBES) {
      expect(UPLOAD_CHECK_IDS).toContain(probe.id);
      expect(probe.filename.length).toBeGreaterThan(0);
      expect(probe.content_type.length).toBeGreaterThan(0);
      expect(probe.description.length).toBeGreaterThan(0);
      expect(typeof probe.active_type).toBe("boolean");
    }
  });

  it("bevat de path-traversal-probe met filename ../canary.txt", () => {
    const probe = UPLOAD_PROBES.find((p) => p.id === "upload-path-traversal");
    expect(probe?.filename).toBe("../canary.txt");
  });

  it("bevat de size-probe big.bin die UPLOAD_SIZE_PROBE_BYTES gebruikt", () => {
    const probe = UPLOAD_PROBES.find((p) => p.id === "upload-size-limit");
    expect(probe?.filename).toBe("big.bin");
    const body = buildProbeBody(probe!, "abc123");
    expect(body.length).toBe(UPLOAD_SIZE_PROBE_BYTES);
  });

  it("bevat de content-type-mismatch-probe shell.php als image/jpeg", () => {
    const mismatch = UPLOAD_PROBES.find((p) => p.filename === "shell.php");
    expect(mismatch?.content_type).toBe("image/jpeg");
    expect(mismatch?.active_type).toBe(true);
  });

  it("bevat de double-extension-probe shell.php.jpg", () => {
    expect(UPLOAD_PROBES.some((p) => p.filename === "shell.php.jpg")).toBe(true);
  });

  it("bevat de content-sniff-probe xss.svg als image/svg+xml", () => {
    const svg = UPLOAD_PROBES.find((p) => p.id === "upload-content-sniff");
    expect(svg?.filename).toBe("xss.svg");
    expect(svg?.content_type).toBe("image/svg+xml");
  });

  it("geen enkele probe-body bevat een echte webshell-/exploit-marker (enkel inerte token-echo)", () => {
    const token = makeCanaryToken();
    for (const probe of UPLOAD_PROBES) {
      const body = buildProbeBody(probe, token).toLowerCase();
      for (const marker of WEBSHELL_MARKERS) {
        expect(body).not.toContain(marker);
      }
    }
  });

  it("elke probe-body bevat het canary-token na substitutie", () => {
    const token = makeCanaryToken();
    for (const probe of UPLOAD_PROBES) {
      expect(buildProbeBody(probe, token)).toContain(token);
    }
  });
});

describe("makeCanaryToken", () => {
  it("genereert 32 lowercase hex-tekens", () => {
    const token = makeCanaryToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("genereert unieke tokens", () => {
    expect(makeCanaryToken()).not.toBe(makeCanaryToken());
  });
});

describe("outputDiffersFromSource", () => {
  it("false wanneer het token niet in de respons voorkomt (geen bewijs)", () => {
    expect(outputDiffersFromSource('<?php echo "tok123"; ?>', "404 not found", "tok123")).toBe(false);
  });

  it("false wanneer de respons identiek is aan de rauwe bron (enkel opgeslagen, niet uitgevoerd)", () => {
    const source = '<?php echo "tok123"; ?>';
    expect(outputDiffersFromSource(source, source, "tok123")).toBe(false);
  });

  it("true wanneer de respons enkel het uitgevoerde token bevat (server-side output)", () => {
    const source = '<?php echo "tok123"; ?>';
    expect(outputDiffersFromSource(source, "tok123", "tok123")).toBe(true);
  });

  it("negeert omringende whitespace bij de source/respons-vergelijking", () => {
    const source = '  <?php echo "tok123"; ?>  ';
    expect(outputDiffersFromSource(source, '<?php echo "tok123"; ?>', "tok123")).toBe(false);
  });

  it("false voor een verbatim teruggegeven groot bestand wanneer bron én body gelijk zijn afgekapt (like-for-like)", () => {
    // Regressie: de size-probe (token vooraan + veel vulling) die de server
    // ongewijzigd opslaat en teruggeeft. Wordt de body afgekapt terwijl de bron
    // ook afgekapt is, dan is dit géén executie — enkel opslag/teruggave.
    const token = "a".repeat(32);
    const truncate = (s: string) => (s.length > 2048 ? s.slice(0, 2048) + "…" : s);
    const source = token + "A".repeat(2 * 1024 * 1024);
    expect(outputDiffersFromSource(truncate(source), truncate(source), token)).toBe(false);
  });
});

describe("classifyUploadOutcome", () => {
  it("high (RCE-klasse): opgeslagen én uitgevoerd", () => {
    const r = classifyUploadOutcome({ stored: true, retrievable: true, executed: true, activeType: true });
    expect(r.severity).toBe("high");
    expect(r.reason).toContain("uitgevoerd");
  });

  it("high (RCE-klasse) ook zonder ophaalbaarheid, zolang executie is waargenomen", () => {
    const r = classifyUploadOutcome({ stored: true, retrievable: false, executed: true, activeType: false });
    expect(r.severity).toBe("high");
  });

  it("high (stored-XSS): actief type opgeslagen én publiek ophaalbaar, niet uitgevoerd", () => {
    const r = classifyUploadOutcome({ stored: true, retrievable: true, executed: false, activeType: true });
    expect(r.severity).toBe("high");
    expect(r.reason).toContain("stored-XSS");
  });

  it("medium: opgeslagen, niet ophaalbaar, niet uitgevoerd", () => {
    const r = classifyUploadOutcome({ stored: true, retrievable: false, executed: false, activeType: true });
    expect(r.severity).toBe("medium");
    expect(r.reason).toContain("filtering");
  });

  it("medium: opgeslagen zonder gevaarlijk type en niet uitgevoerd (geen van beide high-condities)", () => {
    const r = classifyUploadOutcome({ stored: true, retrievable: true, executed: false, activeType: false });
    expect(r.severity).toBe("medium");
  });

  it("low: opgeslagen ondanks uitsluitend een client-side accept-restrictie", () => {
    const r = classifyUploadOutcome({
      stored: true,
      retrievable: false,
      executed: false,
      activeType: false,
      clientSideRestriction: true,
    });
    expect(r.severity).toBe("low");
    expect(r.reason).toContain("client-side");
  });

  it("info: server weigerde het bestand (niet opgeslagen)", () => {
    const r = classifyUploadOutcome({ stored: false, retrievable: false, executed: false, activeType: true });
    expect(r.severity).toBe("info");
    expect(r.reason).toContain("weigerde");
  });

  it("reason bevat geen absolute taal ('altijd', 'gegarandeerd', 'bewezen')", () => {
    const scenarios = [
      { stored: true, retrievable: true, executed: true, activeType: true },
      { stored: true, retrievable: true, executed: false, activeType: true },
      { stored: true, retrievable: false, executed: false, activeType: true },
      {
        stored: true,
        retrievable: false,
        executed: false,
        activeType: false,
        clientSideRestriction: true,
      },
      { stored: false, retrievable: false, executed: false, activeType: false },
    ];
    for (const scenario of scenarios) {
      const r = classifyUploadOutcome(scenario);
      expect(r.reason.toLowerCase()).not.toMatch(/altijd|gegarandeerd|bewezen/);
    }
  });
});
