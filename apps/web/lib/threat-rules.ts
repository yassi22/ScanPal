import "server-only";

import type { Pool } from "pg";
import type { ThreatHoneypotRow, ThreatRuleRow } from "@scanpal/db";

export type ThreatHit = {
  path: string;
  ip: string | null;
  userAgent: string | null;
};

export type RuleMatch = {
  rule_key: ThreatRuleRow["rule_key"];
  risk: ThreatRuleRow["risk"];
};

const PATH_ADMIN =
  /(^|\/)(wp-login(\.php)?|wp-admin|administrator|phpmyadmin|admin\/|cpanel|\.htaccess|\.htpasswd|\.well-known\/acme-challenge)([/?#]|$)/i;
const PATH_ENV =
  /(^|\/)(\.env(\.\w+)?|\.git[/?#]|\.svn[/?#]|config(\.\w+)?\.(json|yml|yaml|php|env)|credentials|\.aws[/?#]|id_rsa|\.ssh[/?#]|\.npmrc)([/?#]|$)/i;
const PATH_TRAVERSAL =
  /(\.\.(\/|\\)|\.\.%2f|\.\.%5c|%2e%2e|%2e%2e%2f|%2e\.|\.%2e|\/etc\/passwd|\/etc\/shadow|\/proc\/self|\/windows\/win\.ini)/i;
const UA_SCANNER =
  /(sqlmap|nikto|nmap|masscan|acunetix|nessus|openvas|gobuster|dirbuster|wpscan|zgrab|hydra|burpsuite|fimap|jbrofuzz|libwww-perl|scrapy|python-requests|postmanruntime)/i;

const RULE_ORDER: ThreatRuleRow["rule_key"][] = [
  "path_traversal",
  "path_env",
  "path_admin",
  "burst",
  "ip_repeat",
  "ua_scanner",
];

const RISK_ORDER: ThreatRuleRow["risk"][] = ["low", "medium", "high", "critical"];

function riskRank(risk: ThreatRuleRow["risk"]): number {
  return RISK_ORDER.indexOf(risk);
}

/**
 * Inline-analyse (v1, laag volume): draait de enabled regels uit
 * `threat_rules` over één honeypot-hit en retourneert de hoogste match
 * (risk, daarna de volgorde hierboven). Burst/IP-herhaling tellen eerdere
 * events van dezelfde honeypot + IP; zonder IP slaan die regels over.
 */
export async function analyzeThreatHit(
  db: Pool,
  honeypot: ThreatHoneypotRow,
  hit: ThreatHit,
): Promise<RuleMatch | null> {
  const rules = await db.query<ThreatRuleRow>(
    `select id, name, rule_key, risk, description, enabled
     from threat_rules where enabled = true`,
  );

  const riskOf = new Map<string, ThreatRuleRow["risk"]>();
  for (const rule of rules.rows) {
    riskOf.set(rule.rule_key, rule.risk);
  }
  const enabled = new Set(riskOf.keys());

  const matches: RuleMatch[] = [];
  const push = (key: ThreatRuleRow["rule_key"]) => {
    const risk = riskOf.get(key);
    if (risk) matches.push({ rule_key: key, risk });
  };

  if (enabled.has("path_traversal") && PATH_TRAVERSAL.test(hit.path)) {
    push("path_traversal");
  }
  if (enabled.has("path_env") && PATH_ENV.test(hit.path)) {
    push("path_env");
  }
  if (enabled.has("path_admin") && PATH_ADMIN.test(hit.path)) {
    push("path_admin");
  }
  if (enabled.has("ua_scanner") && hit.userAgent && UA_SCANNER.test(hit.userAgent)) {
    push("ua_scanner");
  }

  if (enabled.has("burst") && hit.ip) {
    const burst = await db.query<{ n: number }>(
      `select count(*)::int as n from threat_events
       where honeypot_id = $1 and ip = $2::inet
         and created_at > now() - interval '60 seconds'`,
      [honeypot.id, hit.ip],
    );
    if ((burst.rows[0]?.n ?? 0) >= 5) push("burst");
  }

  if (enabled.has("ip_repeat") && hit.ip) {
    const repeat = await db.query<{ n: number }>(
      `select count(*)::int as n from threat_events
       where honeypot_id = $1 and ip = $2::inet
         and created_at > now() - interval '24 hours'`,
      [honeypot.id, hit.ip],
    );
    if ((repeat.rows[0]?.n ?? 0) >= 3) push("ip_repeat");
  }

  if (matches.length === 0) return null;

  return matches.reduce((best, match) => {
    const bestRank = riskRank(best.risk);
    const matchRank = riskRank(match.risk);
    if (matchRank > bestRank) return match;
    if (matchRank === bestRank) {
      return RULE_ORDER.indexOf(match.rule_key) < RULE_ORDER.indexOf(best.rule_key)
        ? match
        : best;
    }
    return best;
  });
}
