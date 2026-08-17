import { describe, it, expect } from "vitest";
import {
  detectStack,
  evaluateStackDetection,
  stackDetectionEvidence,
} from "../stack-detection";
import type { HeaderSource } from "../stack-detection";

function headersFrom(map: Record<string, string>): HeaderSource {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("detectStack", () => {
  it("herkent WordPress uit generator + html markers", () => {
    const matches = detectStack(
      headersFrom({}),
      `<html><head><meta name="generator" content="WordPress 6.4"></head>
       <body><script src="/wp-content/themes/x/main.js"></script></body></html>`,
    );
    const wp = matches.find((m) => m.id === "wordpress");
    expect(wp).toBeDefined();
    expect(wp?.signals.length).toBeGreaterThanOrEqual(2);
  });

  it("herkent Next.js uit X-Powered-By header", () => {
    const matches = detectStack(
      headersFrom({ "x-powered-by": "Next.js" }),
      `<html><body>home</body></html>`,
    );
    expect(matches.some((m) => m.id === "nextjs")).toBe(true);
  });

  it("herkent Cloudflare uit Server header", () => {
    const matches = detectStack(
      headersFrom({ server: "cloudflare", "cf-ray": "abc" }),
      `<html></html>`,
    );
    expect(matches.some((m) => m.id === "cloudflare")).toBe(true);
  });

  it("herkent nginx", () => {
    const matches = detectStack(headersFrom({ server: "nginx/1.25.0" }), "");
    expect(matches.some((m) => m.id === "nginx")).toBe(true);
  });

  it("herkent Django via cookies", () => {
    const matches = detectStack(headersFrom({}), "<html></html>", [
      "csrftoken=abc",
      "sessionid=xyz",
    ]);
    expect(matches.some((m) => m.id === "django")).toBe(true);
  });

  it("geeft info bij geen herkende stack", () => {
    const matches = detectStack(headersFrom({}), "<html></html>");
    expect(matches).toEqual([]);
    const { status, detail } = evaluateStackDetection(matches);
    expect(status).toBe("info");
    expect(detail).toContain("Geen CMS");
  });

  it("combineert meerdere stacks (React + Cloudflare + nginx)", () => {
    const matches = detectStack(
      headersFrom({ server: "cloudflare" }),
      `<html><body><div data-reactroot=""></div></body></html>`,
    );
    const ids = matches.map((m) => m.id);
    expect(ids).toContain("react");
    expect(ids).toContain("cloudflare");
  });
});

describe("evaluateStackDetection + evidence", () => {
  it("pass bij gevonden stacks met namen in detail", () => {
    const matches = detectStack(
      headersFrom({ server: "nginx" }),
      `<html><meta name="generator" content="WordPress 6.0"></html>`,
    );
    const { status, detail } = evaluateStackDetection(matches);
    expect(status).toBe("pass");
    expect(detail).toContain("WordPress");
    expect(detail).toContain("nginx");

    const evidence = stackDetectionEvidence(matches);
    expect(evidence.kind).toBe("stack-detection");
    expect(evidence.detected.length).toBe(2);
    expect(evidence.detected[0]).toMatchObject({
      id: "wordpress",
      category: "cms",
    });
  });
});
