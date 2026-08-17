import { describe, it, expect, vi } from "vitest";
import { renderPdf } from "@/lib/report/pdf";
import { makeFinding, makeRenderData } from "./report-fixtures";

vi.mock("server-only", () => ({}));

describe("renderPdf", () => {
  it("produceert een PDF-buffer die met %PDF begint", async () => {
    const input = makeRenderData({
      findings: [
        makeFinding({
          id: "https:missing",
          title: "HTTPS ontbreekt",
          severity: "critical",
          description: "Geen TLS",
          remediation: "Regel een certificaat",
          evidence: "curl -I example.com",
        }),
      ],
    });
    const buffer = await renderPdf(input);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  }, 30000);

  it("rendert een rapport met niet-Latijnse tekens zonder te falen", async () => {
    const input = makeRenderData({
      site: { url: "пример.рф", label: "Тестовый сайт — Héllo" },
      findings: [
        makeFinding({
          title: "Заголовок — naïve",
          description: "Cyrillisch + accénts",
          remediation: "Исправить",
        }),
      ],
    });
    const buffer = await renderPdf(input);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  }, 30000);
});