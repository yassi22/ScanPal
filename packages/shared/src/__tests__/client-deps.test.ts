import { describe, it, expect } from "vitest";
import {
  detectClientDeps,
  detectRuntimeDeps,
  clientDepsEvidence,
  clientDepsStatus,
} from "../client-deps";
import type { OsvVulnerability } from "../sast-findings";

describe("detectClientDeps (plan 71)", () => {
  it("herkent jsDelivr /npm/<pkg>@<ver>/", () => {
    const [d] = detectClientDeps([
      "https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js",
    ]);
    expect(d).toEqual({
      package: "jquery",
      ecosystem: "npm",
      version: "3.4.1",
      source: "cdn-url",
      origin: "https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js",
    });
  });

  it("herkent jsDelivr scoped package", () => {
    const [d] = detectClientDeps([
      "https://cdn.jsdelivr.net/npm/@scope/lib@1.2.3/dist/index.js",
    ]);
    expect(d?.package).toBe("@scope/lib");
    expect(d?.version).toBe("1.2.3");
  });

  it("herkent unpkg /<pkg>@<ver>/", () => {
    const [d] = detectClientDeps([
      "https://unpkg.com/react@17.0.2/umd/react.production.min.js",
    ]);
    expect(d?.package).toBe("react");
    expect(d?.version).toBe("17.0.2");
  });

  it("herkent klassieke CDN-stijl jquery-<ver>.min.js", () => {
    const [d] = detectClientDeps([
      "https://code.jquery.com/jquery-3.4.1.min.js",
    ]);
    expect(d?.package).toBe("jquery");
    expect(d?.version).toBe("3.4.1");
  });

  it("herkent bootstrap.<ver>.min.js", () => {
    const [d] = detectClientDeps([
      "https://stackpath.bootstrapcdn.com/bootstrap.4.0.0.min.js",
    ]);
    expect(d?.package).toBe("bootstrap");
    expect(d?.version).toBe("4.0.0");
  });

  it("labelt react-dom als eigen package (niet als react)", () => {
    const [d] = detectClientDeps([
      "https://cdnjs.cloudflare.com/react-dom.16.13.0.min.js",
    ]);
    expect(d?.package).toBe("react-dom");
    expect(d?.version).toBe("16.13.0");
  });

  it("herkent klassieke react.<ver>.min.js als react (niet react-dom)", () => {
    const [d] = detectClientDeps([
      "https://cdnjs.cloudflare.com/react.16.13.0.min.js",
    ]);
    expect(d?.package).toBe("react");
    expect(d?.version).toBe("16.13.0");
  });

  it("slaat onbekende / ongeversioneerde URL's over", () => {
    expect(detectClientDeps(["https://example.com/assets/app.js"])).toEqual([]);
    expect(detectClientDeps(["https://example.com/bundle.js"])).toEqual([]);
  });

  it("slaat ongeldige URL's over", () => {
    expect(detectClientDeps(["not-a-url"])).toEqual([]);
  });

  it("dedup op (package, version)", () => {
    const deps = detectClientDeps([
      "https://cdn.jsdelivr.net/npm/lodash@4.17.20/lodash.min.js",
      "https://unpkg.com/lodash@4.17.20/lodash.min.js",
    ]);
    expect(deps).toHaveLength(1);
    expect(deps[0].package).toBe("lodash");
  });

  it("behoudt verschillende versies van dezelfde lib als aparte deps", () => {
    const deps = detectClientDeps([
      "https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js",
      "https://cdn.jsdelivr.net/npm/jquery@3.5.0/dist/jquery.min.js",
    ]);
    expect(deps).toHaveLength(2);
  });
});

describe("clientDepsEvidence + clientDepsStatus (plan 71)", () => {
  const deps = detectClientDeps([
    "https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js",
    "https://unpkg.com/lodash@4.17.20/lodash.min.js",
  ]);

  it("evidence telt kwetsbare deps per worst-severity", () => {
    const vulnsByDep: OsvVulnerability[][] = [
      [
        {
          id: "CVE-1",
          package_name: "jquery",
          ecosystem: "npm",
          version: "3.4.1",
          summary: "xss",
          severity: "high",
        },
      ],
      [], // lodash geen vulns
    ];
    const ev = clientDepsEvidence(deps, vulnsByDep);
    expect(ev.total).toBe(2);
    expect(ev.vulnerable).toBe(1);
    expect(ev.by_severity.high).toBe(1);
    expect(ev.samples[0]).toMatchObject({
      package: "jquery",
      version: "3.4.1",
      severity: "high",
      vuln_ids: ["CVE-1"],
    });
  });

  it("status fail bij critical/high, warn bij medium/low, pass zonder vulns", () => {
    expect(clientDepsStatus(1, { critical: 0, high: 1, medium: 0, low: 0 })).toBe("fail");
    expect(clientDepsStatus(1, { critical: 0, high: 0, medium: 1, low: 0 })).toBe("warn");
    expect(clientDepsStatus(0, { critical: 0, high: 0, medium: 0, low: 0 })).toBe("pass");
  });

  it("evidence leeg bij geen enkele vuln", () => {
    const ev = clientDepsEvidence(deps, [[], []]);
    expect(ev.vulnerable).toBe(0);
    expect(ev.samples).toEqual([]);
  });
});

describe("detectRuntimeDeps (plan 71 v2)", () => {
  it("normaliseert window-globals naar deps met source runtime-global", () => {
    const out = detectRuntimeDeps({
      jquery: "3.4.1",
      react: "17.0.2",
      vue: null,
      angular: undefined,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      package: "jquery",
      ecosystem: "npm",
      version: "3.4.1",
      source: "runtime-global",
      origin: "window.jQuery.fn.jquery",
    });
    expect(out[1]).toMatchObject({ package: "react", version: "17.0.2", source: "runtime-global" });
  });

  it("slaat lege/null/undefined-versies over (geen valse CVE-claim)", () => {
    expect(detectRuntimeDeps({ jquery: "", react: null, vue: undefined })).toEqual([]);
  });

  it("slaat een lege capture over", () => {
    expect(detectRuntimeDeps({})).toEqual([]);
  });

  it("dedup op (package, version)", () => {
    // lodash komt via één global; twee keer dezelfde kan niet voorkomen uit één
    // capture, maar dedup beschermt tegen herhaling in de evidence.
    const out = detectRuntimeDeps({ lodash: "4.17.20" });
    expect(out).toHaveLength(1);
  });

  it("evidence markeert runtime-source", () => {
    const rt = detectRuntimeDeps({ jquery: "3.4.1" });
    const ev = clientDepsEvidence(rt, [[
      { id: "CVE-1", package_name: "jquery", ecosystem: "npm", version: "3.4.1", summary: "xss", severity: "high" },
    ]]);
    expect(ev.samples[0].source).toBe("runtime-global");
    expect(ev.samples[0].origin).toBe("window.jQuery.fn.jquery");
  });
});
