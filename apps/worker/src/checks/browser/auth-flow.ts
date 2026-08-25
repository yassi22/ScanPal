import {
  AUTH_FLOW_CHECK_IDS,
  AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  checkById,
  detectSessionRotation,
  detectUserEnumeration,
  passwordAutocompleteOk,
  sessionCookieIssues,
  truncateEvidence,
  type AuthFlowCapture,
  type AuthFormCapture,
  type FindingEvidence,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { CheckContext } from "../types";
import type { BrowserRunner } from "./runner";

type AuthOutput = InlineCheckLike & {
  active: true;
  evidence: FindingEvidence | null;
};

function evidenceOf(request: string, response: string): FindingEvidence {
  return { request: truncateEvidence(request), response: truncateEvidence(response) };
}

function nameOf(id: string): string {
  return checkById(id)?.name ?? id;
}

/** Eén info-finding per auth-* id wanneer de auth-flow overgeslagen wordt. */
function skipFindings(reason: string): AuthOutput[] {
  return AUTH_FLOW_CHECK_IDS.map((id) => ({
    id,
    name: nameOf(id),
    status: "info" as const,
    detail: `Auth-flow overgeslagen: ${reason}`,
    active: true,
    evidence: null,
  }));
}

function authTransportFinding(forms: AuthFormCapture[]): AuthOutput {
  const id = "auth-transport";
  const name = nameOf(id);
  if (forms.length === 0) {
    return { id, name, status: "info", detail: "Geen auth-formulieren (login/signup/reset) gevonden.", active: true, evidence: null };
  }
  const insecure = forms.filter((f) => !f.https);
  const badAutocomplete = forms.filter((f) => !passwordAutocompleteOk(f.password_autocomplete, f.kind));
  if (insecure.length > 0) {
    return {
      id,
      name,
      status: "warn",
      detail: `${insecure.length}/${forms.length} auth-pagina('s) niet over HTTPS (${insecure[0]!.url}).`,
      active: true,
      evidence: evidenceOf("auth-transport (passief)", `onveilige pagina: ${insecure[0]!.url}`),
    };
  }
  if (badAutocomplete.length > 0) {
    return {
      id,
      name,
      status: "warn",
      detail: `${badAutocomplete.length}/${forms.length} wachtwoord-veld(en) zonder juiste autocomplete (verwacht current-password/new-password).`,
      active: true,
      evidence: evidenceOf("auth-transport (passief)", `formulier ${badAutocomplete[0]!.url}: autocomplete="${badAutocomplete[0]!.password_autocomplete ?? ""}"`),
    };
  }
  return {
    id,
    name,
    status: "pass",
    detail: `Alle ${forms.length} auth-pagina's over HTTPS met juiste wachtwoord-autocomplete.`,
    active: true,
    evidence: null,
  };
}

function authCsrfFinding(forms: AuthFormCapture[]): AuthOutput {
  const id = "auth-csrf";
  const name = nameOf(id);
  if (forms.length === 0) {
    return { id, name, status: "info", detail: "Geen auth-formulieren gevonden.", active: true, evidence: null };
  }
  const withoutToken = forms.filter((f) => !f.csrf_token);
  if (withoutToken.length > 0) {
    return {
      id,
      name,
      status: "warn",
      detail: `${withoutToken.length}/${forms.length} auth-formulier(en) zonder CSRF-token-veld (${withoutToken[0]!.kind} op ${withoutToken[0]!.url}).`,
      active: true,
      evidence: evidenceOf("auth-csrf (passief)", `formulier zonder token: ${withoutToken[0]!.url}`),
    };
  }
  return {
    id,
    name,
    status: "pass",
    detail: `Alle ${forms.length} auth-formulieren bevatten een CSRF-token-veld.`,
    active: true,
    evidence: null,
  };
}

function authUserEnumerationFinding(capture: AuthFlowCapture): AuthOutput {
  const id = "auth-user-enumeration";
  const name = nameOf(id);
  if (!capture.reset_probe) {
    return { id, name, status: "info", detail: "Geen reset-flow gevonden om te testen.", active: true, evidence: null };
  }
  const { nonexistent, known } = capture.reset_probe;
  const result = detectUserEnumeration(nonexistent, known);
  if (result.enumeration) {
    return {
      id,
      name,
      status: "warn",
      detail: result.reason,
      active: true,
      evidence: evidenceOf(
        `POST reset (onbestaand vs. ${known.status === 0 ? "fout" : "bestaand"})`,
        `onbestaand: HTTP ${nonexistent.status} (${nonexistent.duration_ms}ms)\nbestaand: HTTP ${known.status} (${known.duration_ms}ms)\n${known.body.slice(0, 400)}`,
      ),
    };
  }
  return {
    id,
    name,
    status: "pass",
    detail: result.reason,
    active: true,
    evidence: null,
  };
}

function authRateLimitFinding(capture: AuthFlowCapture): AuthOutput {
  const id = "auth-rate-limit";
  const name = nameOf(id);
  const attempts = capture.rate_limit_attempts;
  if (attempts.length === 0) {
    return { id, name, status: "info", detail: "Geen login-formulier gevonden om te testen.", active: true, evidence: null };
  }
  const locked = attempts.some((a) => a.locked);
  if (locked) {
    const firstLocked = attempts.findIndex((a) => a.locked);
    return {
      id,
      name,
      status: "pass",
      detail: `Rate-limiting/lockout trad in na ${firstLocked + 1} foute poging(en) tegen het eigen wegwerp-account.`,
      active: true,
      evidence: evidenceOf(
        `Burst ${attempts.length}× foute login`,
        attempts.map((a, i) => `#${i + 1}: HTTP ${a.status}${a.locked ? " (lockout)" : ""}`).join("\n"),
      ),
    };
  }
  return {
    id,
    name,
    status: "warn",
    detail: `Geen rate-limiting/lockout waargenomen onder ${attempts.length}/${AUTH_RATE_LIMIT_MAX_ATTEMPTS} foute pogingen (alleen tegen het eigen wegwerp-account).`,
    active: true,
    evidence: evidenceOf(
      `Burst ${attempts.length}× foute login`,
      attempts.map((a, i) => `#${i + 1}: HTTP ${a.status}`).join("\n"),
    ),
  };
}

function authPasswordPolicyFinding(capture: AuthFlowCapture): AuthOutput {
  const id = "auth-password-policy";
  const name = nameOf(id);
  const policy = capture.password_policy;
  if (!policy) {
    return { id, name, status: "info", detail: "Geen signup/reset-formulier gevonden om wachtwoord-policy te testen.", active: true, evidence: null };
  }
  if (policy.accepted) {
    return {
      id,
      name,
      status: "warn",
      detail: "Triviaal zwak wachtwoord (123456) wordt geaccepteerd op validatieniveau zonder afwijzing.",
      active: true,
      evidence: evidenceOf("password-policy probe (123456)", policy.validation_message || "geen validatiefout"),
    };
  }
  return {
    id,
    name,
    status: "pass",
    detail: `Zwak wachtwoord (123456) afgewezen op validatieniveau${policy.validation_message ? `: "${policy.validation_message}"` : ""}.`,
    active: true,
    evidence: null,
  };
}

function authSessionSecurityFinding(capture: AuthFlowCapture): AuthOutput {
  const id = "auth-session-security";
  const name = nameOf(id);
  const session = capture.session;
  if (!session || !session.logged_in) {
    return { id, name, status: "info", detail: "Login met het wegwerp-account niet uitvoerbaar of niet geslaagd — sessie-observaties zijn niet betrouwbaar, dus geen oordeel.", active: true, evidence: null };
  }
  const issues = sessionCookieIssues(session.cookies);
  const rotation = detectSessionRotation(session.session_id_before, session.session_id_after);
  const problems: string[] = [];
  for (const issue of issues) problems.push(`${issue.name}: ${issue.issues.join(", ")}`);
  if (rotation.measurable && !rotation.rotated) {
    problems.push("sessie-id roteert niet na login (session-fixatie)");
  }
  if (problems.length > 0) {
    return {
      id,
      name,
      status: "warn",
      detail: problems.join("; "),
      active: true,
      evidence: evidenceOf(
        "session-security (login met wegwerp-account)",
        `cookies: ${session.cookies.map((c) => `${c.name}(Secure=${c.secure},HttpOnly=${c.http_only},SameSite=${c.same_site})`).join(", ")}\nsessie-id voor/na: ${session.session_id_before ?? "—"} / ${session.session_id_after ?? "—"}`,
      ),
    };
  }
  return {
    id,
    name,
    status: "pass",
    detail: `Sessie-cookies dragen Secure/HttpOnly/SameSite${rotation.measurable ? " en het sessie-id roteert na login" : ""}.`,
    active: true,
    evidence: null,
  };
}

function authMfaFinding(capture: AuthFlowCapture): AuthOutput {
  const id = "auth-mfa";
  const name = nameOf(id);
  const mfa = capture.mfa;
  if (!mfa) {
    return { id, name, status: "info", detail: "MFA niet meetbaar (login niet uitvoerbaar).", active: true, evidence: null };
  }
  if (mfa.enforced) {
    return { id, name, status: "pass", detail: "MFA is afgedwongen na login.", active: true, evidence: null };
  }
  if (mfa.available) {
    return {
      id,
      name,
      status: "warn",
      detail: "MFA is beschikbaar maar niet afgedwongen.",
      active: true,
      evidence: evidenceOf("mfa-signaal (post-login)", mfa.signal),
    };
  }
  return { id, name, status: "info", detail: "Geen MFA-signaal gevonden na login (best-effort observatie).", active: true, evidence: null };
}

/**
 * Authentication flow scanner (plan 77). Actieve, veilige subset achter
 * driedubbele gating: `active_tests` + live domeineigendom + wegwerp-testaccount.
 * Draait in de browser-queue (Playwright via de injectable BrowserRunner).
 * Eén implementatie produceert de zeven `auth-*`-findings (`active: true`,
 * niet in de score). Niet-destructief: geen blijvend account, geen mail-storm,
 * rate-limit-burst alleen tegen het eigen wegwerp-account en hard begrensd.
 */
export function createAuthFlowCheck(
  runner: BrowserRunner,
): CheckImplementation {
  return {
    id: "auth-flow",
    category: "http",
    async run(ctx: CheckContext): Promise<InlineCheckLike[]> {
      // Driedubbele gating (besluit 2). De scan-worker filtert de impl er al
      // uit wanneer !activeTests; deze guard is defense-in-depth.
      if (!ctx.activeTests) return [];

      if (ctx.ownershipVerified === false) {
        return skipFindings(
          "domeineigendom niet live geverifieerd (plan 76). Verifieer eerst eigendom via de DNS-TXT-record.",
        );
      }
      if (!ctx.authCredentials) {
        return skipFindings(
          "geen wegwerp-testaccount ingesteld voor deze site. Voeg een test-account toe om de auth-flow te scannen.",
        );
      }

      const rate = await ctx.rateLimit(`auth-flow:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return skipFindings(`rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`);
      }

      const res = await runner.captureAuthFlow(ctx.url, ctx.authCredentials);
      if (!res.ok) {
        return skipFindings(`browser-capture mislukt: ${res.error}`);
      }

      const capture = res.capture;
      return [
        authTransportFinding(capture.forms),
        authCsrfFinding(capture.forms),
        authUserEnumerationFinding(capture),
        authRateLimitFinding(capture),
        authPasswordPolicyFinding(capture),
        authSessionSecurityFinding(capture),
        authMfaFinding(capture),
      ];
    },
  };
}
