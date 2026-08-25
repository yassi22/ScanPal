import { z } from "zod";

/**
 * Authentication flow scanner (plan 77) — login / signup / password-reset.
 * Actieve, veilige subset achter driedubbele gating (opt-in + Pro + live
 * domeineigendom + wegwerp-testaccount). Draait in de browser-worker (Playwright).
 *
 * Deze module is puur (geen netwerk): de runner levert een {@link AuthFlowCapture}
 * met ruwe observaties; de check interpreteert die tot 7 `auth-*`-findings
 * (`active: true`, niet in de score). Evidence = request/response (afgekapt,
 * plan 52 besluit 6). Detectie-helpers zijn unit-testbaar op mock-responses.
 */

/** De zeven catalog-ids die één auth-flow-implementatie produceert. */
export const AUTH_FLOW_CHECK_IDS = [
  "auth-transport",
  "auth-csrf",
  "auth-user-enumeration",
  "auth-rate-limit",
  "auth-password-policy",
  "auth-session-security",
  "auth-mfa",
] as const;
export type AuthFlowCheckId = (typeof AUTH_FLOW_CHECK_IDS)[number];

/** Wegwerp-testaccount (gedecrypteerd, via ctx aan de check doorgegeven). */
export const authCredentialsSchema = z.object({
  login_url: z.string().nullable(),
  username: z.string(),
  password: z.string(),
});
export type AuthCredentials = z.infer<typeof authCredentialsSchema>;

/** Input voor opslag van het wegwerp-testaccount (API-grens). */
export const authCredentialsInputSchema = z.object({
  login_url: z.string().url().nullable().optional(),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});
export type AuthCredentialsInput = z.infer<typeof authCredentialsInputSchema>;

/** Response van één auth-probe (reset / login-poging), afgekapt door de runner. */
export type AuthProbeResponse = {
  status: number;
  body: string;
  duration_ms: number;
};

export const authFormKindSchema = z.enum(["login", "signup", "reset"]);
export type AuthFormKind = z.infer<typeof authFormKindSchema>;

/** Passief waargenomen auth-formulier (login/signup/reset). */
export type AuthFormCapture = {
  url: string;
  kind: AuthFormKind;
  https: boolean;
  password_autocomplete: string | null;
  csrf_token: boolean;
};

/** Eén foute-wachtwoord-poging in de begrensde rate-limit-burst. */
export type AuthRateLimitAttempt = {
  status: number;
  body: string;
  /** Runner herkende een lockout-signaal (account-locked-tekst / 423 / 429 op login). */
  locked: boolean;
};

/**
 * Zwak-wachtwoord-validatie-probe. Puur validatieniveau: de flow rondt de
 * registratie nooit af (geen submit, geen account-creatie), dus er is bewust
 * geen `submitted`-signaal — de probe blijft niet-destructief.
 */
export type AuthPasswordPolicyProbe = {
  accepted: boolean;
  validation_message: string;
  /**
   * Of het oordeel client-side überhaupt meetbaar was: er is een client-side
   * constraint (minlength/pattern) aanwezig, óf de site wees het wachtwoord
   * actief af. `false` → er is geen client-side signaal en server-side
   * validatie is niet observeerbaar, dus de check degradeert naar info i.p.v.
   * een vals-positieve "zwak wachtwoord geaccepteerd"-melding.
   */
  measurable: boolean;
};

export type AuthSessionCookie = {
  name: string;
  secure: boolean;
  http_only: boolean;
  same_site: string;
};

export type AuthSessionCapture = {
  /**
   * Of de login met het wegwerp-account daadwerkelijk slaagde. `false` → de
   * cookie-/rotatie-observaties zijn niet betrouwbaar (login-formulier nog
   * zichtbaar, foutmelding getoond, of geen sessie-cookie gezet), dus de
   * session-security- en MFA-checks degraderen naar info i.p.v. een vals-
   * positieve "veilig"-melding.
   */
  logged_in: boolean;
  cookies: AuthSessionCookie[];
  session_id_before: string | null;
  session_id_after: string | null;
};

export type AuthMfaCapture = {
  available: boolean;
  enforced: boolean;
  signal: string;
};

/** Volledige observatie-set die de runner teruggeeft; de check interpreteert. */
export type AuthFlowCapture = {
  forms: AuthFormCapture[];
  reset_probe: { nonexistent: AuthProbeResponse; known: AuthProbeResponse } | null;
  rate_limit_attempts: AuthRateLimitAttempt[];
  password_policy: AuthPasswordPolicyProbe | null;
  session: AuthSessionCapture | null;
  mfa: AuthMfaCapture | null;
  errors: string[];
};

/** Resultaat van de runner-aanroep (`ok: false` → check degradeert naar info). */
export type AuthFlowRunResult =
  | { ok: true; capture: AuthFlowCapture }
  | { ok: false; error: string };

/** Hard begrensde burst-grootte voor de rate-limit-probe (≤5, plan 77 besluit 5). */
export const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 5;

/**
 * Timing-verschil (ms) waarboven user-enumeration via reset-timing aannemelijk
 * is. Ruim boven normale jitter, en de runner vergelijkt mediane duren over
 * meerdere samples (niet één meting) zodat een enkele uitschieter niet trekt.
 */
export const ENUMERATION_TIMING_THRESHOLD_MS = 1000;

/**
 * Beoordeel de `autocomplete`-hygiëne van een wachtwoord-veld. Goed:
 * `current-password` (login) of `new-password` (signup/reset). Leeg of een
 * andere waarde (bijv. `off`, `username`) is een hygiëne-finding.
 */
export function passwordAutocompleteOk(
  attr: string | null,
  kind: AuthFormKind,
): boolean {
  if (attr === null) return false;
  const value = attr.trim().toLowerCase();
  if (kind === "login") return value === "current-password";
  return value === "new-password";
}

/**
 * Normaliseer een response-body voor vergelijking. Naast whitespace + case
 * worden vluchtige tokens gestript (CSRF-nonces, JWT's, base64url-tokens,
 * hashes, timestamps, lange numerieke id's). Zonder dit zou een correct
 * geïmplementeerde site — die per request een nieuw anti-CSRF-token of
 * timestamp rendert — twee identieke reset-pagina's als "verschillend" tonen
 * en een vals-positieve user-enumeration opleveren.
 */
function normalizeBody(body: string): string {
  return body
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z0-9_-]{24,}/g, "◊") // JWT's, base64url-/CSRF-tokens
    .replace(/[0-9a-f]{16,}/gi, "◊") // hex-hashes/tokens
    .replace(/\d{6,}/g, "◊") // timestamps, lange numerieke id's
    .trim()
    .toLowerCase();
}

/**
 * Vergelijk de reset-respons voor een bekend-onbestaand vs. het eigen
 * wegwerp-e-mailadres. Verschilt status, body of timing zó dat de site lekt
 * wélke e-mails bestaan → user-enumeration mogelijk (besluit 4).
 */
export function detectUserEnumeration(
  nonexistent: AuthProbeResponse,
  known: AuthProbeResponse,
): { enumeration: boolean; measurable: boolean; reason: string } {
  // Status 0 is de runner-sentinel voor "geen betrouwbare respons" (reset-pagina
  // onbereikbaar, e-mailveld niet gevonden, geen navigatie). Als één van beide
  // probes niet echt draaide, is een gelijke status/body geen bewijs van een
  // uniforme respons — dan is er niets gemeten en mag de check geen "veilig"
  // (pass) tonen, maar degradeert naar info.
  if (nonexistent.status === 0 || known.status === 0) {
    return {
      enumeration: false,
      measurable: false,
      reason: "reset-probe niet uitvoerbaar (geen betrouwbare respons) — geen oordeel over user-enumeration",
    };
  }
  if (nonexistent.status !== known.status) {
    return {
      enumeration: true,
      measurable: true,
      reason: `reset-respons verschilt: onbestaand HTTP ${nonexistent.status} vs. bestaand HTTP ${known.status}`,
    };
  }
  const a = normalizeBody(nonexistent.body);
  const b = normalizeBody(known.body);
  if (a !== b) {
    return {
      enumeration: true,
      measurable: true,
      reason:
        "reset-respons verschilt: onbestaand vs. bestaand e-mailadres leveren een andere body op bij gelijke status",
    };
  }
  const delta = Math.abs(nonexistent.duration_ms - known.duration_ms);
  if (delta >= ENUMERATION_TIMING_THRESHOLD_MS) {
    return {
      enumeration: true,
      measurable: true,
      reason: `reset-timing verschilt ${delta}ms (≥ ${ENUMERATION_TIMING_THRESHOLD_MS}ms) → timing-gebaseerde enumeratie mogelijk`,
    };
  }
  return { enumeration: false, measurable: true, reason: "uniforme reset-respons (status, body, timing)" };
}

/**
 * Session-fixatie-detectie: roteert het sessie-id ná login? `true` = geroteerd
 * (goed). `false` wanneer beide ids aanwezig én identiek (fixatie-risico).
 * `null` wanneer niet meetbaar (geen id voor/na).
 */
export function detectSessionRotation(
  before: string | null,
  after: string | null,
): { rotated: boolean; measurable: boolean } {
  if (!before || !after) return { rotated: false, measurable: false };
  return { rotated: before !== after, measurable: true };
}

/**
 * Heuristiek: cookienaam wijst op een sessie-token. Bewust ZONDER `csrf`/`xsrf`:
 * double-submit CSRF-cookies (Django `csrftoken`, Laravel/Angular `XSRF-TOKEN`)
 * horen JS-leesbaar te zijn, dus mogen ze niet als "HttpOnly ontbreekt" worden
 * geflagd door {@link sessionCookieIssues}.
 */
const SESSION_COOKIE_NAME_RE =
  /^(?:session|sess|sid|token|auth|jwt|remember|laravel_session|phpsessid|connect\.sid|_session)/i;

export function isSessionCookie(name: string): boolean {
  return SESSION_COOKIE_NAME_RE.test(name);
}

/**
 * Beoordeel sessie-cookie-flags. Retourneert de issues per cookie (Secure /
 * HttpOnly / SameSite). SameSite `none` zonder Secure is altijd een issue.
 */
export function sessionCookieIssues(
  cookies: AuthSessionCookie[],
): { name: string; issues: string[] }[] {
  const out: { name: string; issues: string[] }[] = [];
  for (const c of cookies) {
    if (!isSessionCookie(c.name)) continue;
    const issues: string[] = [];
    if (!c.secure) issues.push("Secure ontbreekt");
    if (!c.http_only) issues.push("HttpOnly ontbreekt");
    const sameSite = c.same_site.toLowerCase();
    if (sameSite === "" || sameSite === "none") {
      if (sameSite === "none" && c.secure) {
        // SameSite=None + Secure is toegestaan maar zwakker; melden als laag.
        issues.push("SameSite=None (zwakker dan Lax/Strict)");
      } else if (sameSite === "none") {
        issues.push("SameSite=None zonder Secure");
      } else {
        issues.push("SameSite ontbreekt");
      }
    }
    if (issues.length > 0) out.push({ name: c.name, issues });
  }
  return out;
}
