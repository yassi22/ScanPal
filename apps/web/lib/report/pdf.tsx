import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { evidenceText, scanCategories, severityOrder, type Finding } from "@scanpal/shared";
import {
  categoryLabelEn,
  severityLabel,
  statusLabelEn,
  triggerLabelEn,
  type ReportRenderData,
} from "./data";

/**
 * Default PDF-base14 fonts (Helvetica/Courier) dekken alleen Latin-1; niet-Latijnse
 * tekens (Cyrillisch, Grieks, uitgebreid Latijn) vallen weg. DejaVu Sans (publiek
 * domein) heeft brede Unicode-dekking en wordt bij module-load geregistreerd. Als
 * het bestand ontbreekt (bijv. lokaal zonder assets), valt het rapport terug op
 * Helvetica — rapport blijft genereren, alleen zonder Unicode-dekking.
 */
const FONT_DIR = "assets/fonts";
let reportFontFamily = "Helvetica";
try {
  const regular = readFileSync(path.resolve(process.cwd(), FONT_DIR, "DejaVuSans.ttf"));
  const bold = readFileSync(path.resolve(process.cwd(), FONT_DIR, "DejaVuSans-Bold.ttf"));
  Font.register({
    family: "DejaVu",
    fonts: [
      { src: `data:font/ttf;base64,${regular.toString("base64")}`, fontWeight: 400 },
      { src: `data:font/ttf;base64,${bold.toString("base64")}`, fontWeight: 700 },
    ],
  });
  reportFontFamily = "DejaVu";
} catch (err) {
  console.error("DejaVu-font niet geladen, valt terug op Helvetica:", err);
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    lineHeight: 1.5,
    color: "#0f172a",
    fontFamily: reportFontFamily,
  },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  subtitle: { fontSize: 12, color: "#475569", marginBottom: 20 },
  section: { fontSize: 14, fontWeight: "bold", marginTop: 16, marginBottom: 8 },
  meta: { marginBottom: 2 },
  metaLabel: { color: "#64748b" },
  score: { fontSize: 16, fontWeight: "bold", marginTop: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    fontWeight: "bold",
  },
  tableCell: { flex: 1, paddingVertical: 4, paddingRight: 8 },
  findingTitle: { fontSize: 11, fontWeight: "bold", marginTop: 12, marginBottom: 2 },
  findingMeta: { color: "#475569", marginBottom: 4 },
  blockLabel: { fontWeight: "bold", marginTop: 6, marginBottom: 2 },
  block: { marginBottom: 2 },
  evidence: {
    fontFamily: reportFontFamily,
    fontSize: 8,
    backgroundColor: "#f1f5f9",
    padding: 6,
    marginBottom: 2,
  },
  more: { color: "#64748b", marginTop: 4, marginBottom: 8 },
  footer: { color: "#94a3b8", marginTop: 24, fontSize: 9 },
});

function metaRow(label: string, value: string) {
  return (
    <Text style={styles.meta}>
      <Text style={styles.metaLabel}>{label}: </Text>
      {value}
    </Text>
  );
}

function tableRow(cells: (string | number)[], head = false, key?: string) {
  return (
    <View key={key} style={head ? styles.tableHead : styles.tableRow}>
      {cells.map((cell, index) => (
        <Text key={index} style={styles.tableCell}>
          {cell}
        </Text>
      ))}
    </View>
  );
}

function FindingBlock({ finding }: { finding: Finding }) {
  const evidence = evidenceText(finding.evidence);
  return (
    <View wrap={false}>
      <Text style={styles.findingTitle}>{finding.title}</Text>
      <Text style={styles.findingMeta}>
        {categoryLabelEn[finding.category]} · {severityLabel[finding.severity]} ·{" "}
        {statusLabelEn[finding.status]}
        {finding.note ? ` · Note: ${finding.note}` : ""}
      </Text>
      <Text style={styles.blockLabel}>Description</Text>
      <Text style={styles.block}>{finding.description}</Text>
      <Text style={styles.blockLabel}>Remediation</Text>
      <Text style={styles.block}>{finding.remediation}</Text>
      {evidence && (
        <>
          <Text style={styles.blockLabel}>Evidence</Text>
          <Text style={styles.evidence}>{evidence}</Text>
        </>
      )}
    </View>
  );
}

export function ReportDocument({ input }: { input: ReportRenderData }) {
  const { data, omitted } = input;
  const { scan, site, score, category_scores, summary, findings } = data;
  const siteName = site.label ?? site.url;
  const displayUrl = /^https?:\/\//i.test(site.url) ? site.url : `https://${site.url}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>ScanPal Report</Text>
        <Text style={styles.subtitle}>{siteName}</Text>

        {metaRow("URL", displayUrl)}
        {metaRow("Scan ID", scan.id)}
        {metaRow("Trigger", triggerLabelEn[scan.trigger])}
        {metaRow("Created", new Date(scan.created_at).toISOString().slice(0, 16).replace("T", " "))}
        {metaRow("Completed", new Date(scan.completed_at).toISOString().slice(0, 16).replace("T", " "))}
        <Text style={styles.score}>Overall score: {score}/100</Text>

        <Text style={styles.section}>Category Scores</Text>
        {tableRow(["Category", "Score"], true)}
        {scanCategories.map((category) =>
          tableRow(
            [
              categoryLabelEn[category],
              category_scores[category] === null
                ? "not scanned"
                : category_scores[category]!,
            ],
            false,
            category,
          ),
        )}

        <Text style={styles.section}>Summary</Text>
        {tableRow(["Severity", "Count"], true)}
        {severityOrder.map((severity) =>
          tableRow([severityLabel[severity], summary[severity]], false, severity),
        )}

        <Text style={styles.section}>Findings</Text>

        {severityOrder.map((severity) => {
          const bucket = findings.filter((finding) => finding.severity === severity);
          const extra = omitted[severity];
          if (bucket.length === 0 && extra === 0) return null;
          return (
            <View key={severity}>
              <Text style={{ ...styles.section, fontSize: 12, marginBottom: 0 }}>
                {severityLabel[severity]}
              </Text>
              {bucket.map((finding) => (
                <FindingBlock key={finding.id} finding={finding} />
              ))}
              {extra > 0 && (
                <Text style={styles.more}>… and {extra} more</Text>
              )}
            </View>
          );
        })}

        {input.prompts && input.prompts.length > 0 && (
          <View wrap={false}>
            <Text style={styles.section}>Fix Prompts</Text>
            <Text style={styles.block}>
              Copy-paste prompts for an AI editor (Cursor/Claude/Windsurf) to
              fix the findings above.
            </Text>
            {input.prompts.map((prompt, index) => (
              <View key={index} wrap={false}>
                <Text style={styles.findingTitle}>Fix prompt {index + 1}</Text>
                <Text style={styles.evidence}>{prompt}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Generated by ScanPal on {new Date().toISOString().slice(0, 10)}.
        </Text>
      </Page>
    </Document>
  );
}

const RENDER_TIMEOUT_MS = 30_000;

/**
 * Rendert het rapport naar een PDF-buffer met een harde timeout. Zware scans
 * (200+ findings) kunnen een grote buffer opleveren; de timeout voorkomt dat een
 * vastgelopen render de route oneindig blokkeert. Bij timeout of fout rejected
 * de promise — de route vangt dit op en retourneert 500 zonder een `reports`-rij
 * op te slaan.
 */
export async function renderPdf(input: ReportRenderData): Promise<Buffer> {
  const render = renderToBuffer(<ReportDocument input={input} />);
  const timer = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("PDF-rendering timed out")),
      RENDER_TIMEOUT_MS,
    );
  });
  return Promise.race([render, timer]) as Promise<Buffer>;
}