import { describe, expect, it } from "vitest";
import { hasUnsanitizedTraversalEvidence, isSameOriginUrl } from "../upload-safety";

describe("upload-flow safety (plan 78)", () => {
  it("accepteert alleen URLs binnen de geverifieerde origin", () => {
    expect(isSameOriginUrl("/upload", "https://example.com/start")).toBe(true);
    expect(isSameOriginUrl("https://example.com/profile", "https://example.com/start")).toBe(true);
    expect(isSameOriginUrl("https://evil.example/upload", "https://example.com/start")).toBe(false);
    expect(isSameOriginUrl("https://example.com.evil.test/upload", "https://example.com/start")).toBe(false);
  });

  it("onderscheidt ongesanitiseerde traversal van gewone canary-opslag", () => {
    expect(hasUnsanitizedTraversalEvidence("stored as ../canary.txt")).toBe(true);
    expect(hasUnsanitizedTraversalEvidence("/uploads/%2e%2e%2fcanary.txt")).toBe(true);
    expect(hasUnsanitizedTraversalEvidence("/uploads/%252e%252e%252fcanary.txt")).toBe(true);
    expect(hasUnsanitizedTraversalEvidence("/uploads/canary.txt")).toBe(false);
    expect(hasUnsanitizedTraversalEvidence("stored as canary.txt")).toBe(false);
  });
});
