import { describe, it, expect } from "vitest";
import {
  SECRETS_IN_HTML_LIMITS,
  htmlSecretLocationLabels,
  scanHtmlForSecrets,
  secretsInHtmlEvidence,
  worstHtmlSecretSeverity,
} from "../secrets-in-html";

const STRIPE_SECRET = "sk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";
const STRIPE_PUBLISHABLE = "pk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz";
const GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";
const GOOGLE_KEY = "AIzaSyB1234567890abcdefghijklmnopqrstuv";

describe("scanHtmlForSecrets (feature 33)", () => {
  it("vindt keys in inline <script> zonder src en tagt locatie inline-script", () => {
    const html = `<html><head></head><body>
      <script>const KEY = "${STRIPE_SECRET}";</script>
      <script src="/app.js"></script>
    </body></html>`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      key_type: "stripe_secret_key",
      provider: "stripe",
      location: "inline-script",
      match_preview: "sk_l…WxYz",
      severity: "critical",
    });
  });

  it("negeert <script> met src voor inline-extractie (geen lege content)", () => {
    const html = `<script src="/app.js"></script>`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(0);
  });

  it("vindt keys in HTML-commentaar en tagt locatie html-comment", () => {
    const html = `<!-- TODO: verwijder ${GITHUB_TOKEN} voor release -->`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      key_type: "github_token",
      provider: "github",
      location: "html-comment",
      match_preview: "ghp_…89AB",
      severity: "critical",
    });
  });

  it("vindt keys in ruwe HTML-attributen/meta en tagt locatie raw-html", () => {
    const html = `<meta name="api-key" content="${GOOGLE_KEY}" />`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      key_type: "google_api_key",
      provider: "google",
      location: "raw-html",
      match_preview: "AIza…stuv",
      severity: "low",
    });
  });

  it("dedupeert dezelfde raw-waarde over segmenten (eerste locatie wint)", () => {
    const html = `
      <script>const KEY = "${STRIPE_SECRET}";</script>
      <!-- ${STRIPE_SECRET} -->
      <meta name="k" content="${STRIPE_SECRET}" />
    `;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].location).toBe("inline-script");
  });

  it("stript <style>-blokken zodat ze niet als raw-html worden gescand", () => {
    const html = `<style>.x { content: "${STRIPE_SECRET}"; }</style>`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(0);
  });

  it("een publishable key is low severity → worstHtmlSecretSeverity = low", () => {
    const html = `<script>const PK = "${STRIPE_PUBLISHABLE}";</script>`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(1);
    expect(worstHtmlSecretSeverity(result.matches)).toBe("low");
  });

  it("geen matches → lege array, severity info", () => {
    const html = `<html><body><p>geen secrets hier</p></body></html>`;
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(0);
    expect(worstHtmlSecretSeverity(result.matches)).toBe("info");
  });

  it("kaapt af op de maxMatches-limiet", () => {
    const many = Array.from(
      { length: SECRETS_IN_HTML_LIMITS.maxMatches + 5 },
      () => `<script>const K = "${STRIPE_SECRET}";</script>`,
    ).join("\n");
    const result = scanHtmlForSecrets(many);
    // Allemaal dezelfde raw-waarde → geduplakeerd tot 1.
    expect(result.matches).toHaveLength(1);
  });

  it("kaapt af bij verschillende keys op maxMatches", () => {
    const keys = Array.from(
      { length: SECRETS_IN_HTML_LIMITS.maxMatches + 5 },
      (_, i) => `sk_live_${String(i).padStart(20, "x")}`,
    );
    const html = keys.map((k) => `<script>const K${Math.random()} = "${k}";</script>`).join("\n");
    const result = scanHtmlForSecrets(html);
    expect(result.matches).toHaveLength(SECRETS_IN_HTML_LIMITS.maxMatches);
  });

  it("secretsInHtmlEvidence produceert het juiste structuur", () => {
    const html = `<script>const KEY = "${STRIPE_SECRET}";</script>`;
    const result = scanHtmlForSecrets(html);
    const evidence = secretsInHtmlEvidence(result);
    expect(evidence.kind).toBe("secrets-in-html");
    expect(evidence.matches).toEqual(result.matches);
    expect(evidence.notes).toEqual([]);
  });

  it("htmlSecretLocationLabels dekt alle locaties", () => {
    expect(Object.keys(htmlSecretLocationLabels).sort()).toEqual(
      ["html-comment", "inline-script", "raw-html"],
    );
  });

  it("maskSecret toont nooit meer dan 4+4 tekens (via preview)", () => {
    const html = `<script>const T = "${GITHUB_TOKEN}";</script>`;
    const result = scanHtmlForSecrets(html);
    const preview = result.matches[0].match_preview;
    expect(preview).toContain("…");
    expect(preview.replace("…", "").length).toBeLessThanOrEqual(8);
    expect(preview).not.toContain(GITHUB_TOKEN);
  });
});
