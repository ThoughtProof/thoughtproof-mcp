/**
 * Thin Sentinel client for verify_decision (not the verify_trade path).
 * POST https://sentinel.thoughtproof.ai/sentinel/verify
 * Auth: X-Sentinel-Key. No x402 in v1.
 * mode is OpenAPI-verified: action_authorization.
 *
 * Provenance: Sentinel PLV (faithfulness) requires the cascade LLM to emit a
 * verbatim quote that is a substring of `evidence`. The live validator
 * (ALLOWED_BODY_FIELDS) rejects a top-level `quote` with HTTP 400, so the
 * mandate quote is wired *into* evidence — never as a sibling field.
 */

export const SENTINEL_VERIFY_URL = "https://sentinel.thoughtproof.ai/sentinel/verify";
export const SENTINEL_OPENAPI_URL = "https://sentinel.thoughtproof.ai/openapi.json";
export const DEFAULT_TIMEOUT_MS = 90_000;

/** Sentinel ActionKind — host-declared `mandate.kind` / `action.kind` (issue #21 / Sentinel #51). */
export const ACTION_KINDS = [
  "informational",
  "value_transfer",
  "permission",
  "deploy_ship",
  "unknown",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface SentinelDecisionInput {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
  /**
   * Optional host-supplied verbatim excerpt of the user mandate.
   * Used only when it is a substring of `mandate` and at least
   * {@link HOST_QUOTE_MIN_CHARS} characters; otherwise the full mandate
   * is the quote. Never forwarded as a top-level Sentinel body field.
   */
  quote?: string;
  /**
   * Optional host-declared Sentinel ActionKind for the mandate
   * (`mandate.kind`). Omit rather than guess. Invalid values are not
   * rewritten to a nearby kind.
   */
  mandate_kind?: ActionKind | string;
  /**
   * Optional host-declared Sentinel ActionKind for the proposed action
   * (`action.kind`). Omit rather than guess.
   */
  action_kind?: ActionKind | string;
}

/** Host `quote` shorter than this falls back to the full mandate. */
export const HOST_QUOTE_MIN_CHARS = 20;

export type MandateQuoteFallbackReason =
  | "omitted"
  | "too_short"
  | "not_in_mandate"
  | "whitespace_normalized_only";

export interface MandateQuoteResolution {
  /** Span embedded as the provenance quote (host excerpt or full mandate). */
  quote: string;
  usedHostQuote: boolean;
  fallbackReason?: MandateQuoteFallbackReason;
}

/**
 * POST /sentinel/verify properties documented on live OpenAPI
 * (`SENTINEL_OPENAPI_URL`). Contract tests fail if this set drifts.
 */
export const SENTINEL_OPENAPI_VERIFY_BODY_FIELDS = [
  "id",
  "claim",
  "evidence",
  "mode",
  "tier",
  "mandate",
  "gateMode",
  "agent_context",
] as const;

/**
 * Extra fields Sentinel's request validator accepts that public OpenAPI
 * does not yet document. Not sent by this MCP outbound body.
 */
export const SENTINEL_VALIDATOR_EXTRA_BODY_FIELDS = [
  "signed_evidence",
  "key_manifest",
  "required_conditions",
  "action_hash",
] as const;

/** Fields Sentinel /sentinel/verify accepts at body top level (strict whitelist). */
export const SENTINEL_VERIFY_BODY_FIELDS = [
  ...SENTINEL_OPENAPI_VERIFY_BODY_FIELDS,
  ...SENTINEL_VALIDATOR_EXTRA_BODY_FIELDS,
] as const;

export function parseSentinelVerifyOpenApiBody(spec: unknown): {
  properties: string[];
  required: string[];
} {
  if (!spec || typeof spec !== "object") {
    throw new Error("OpenAPI spec must be an object");
  }
  const schema = (spec as Record<string, any>).paths?.["/sentinel/verify"]?.post
    ?.requestBody?.content?.["application/json"]?.schema;
  if (!schema || typeof schema !== "object") {
    throw new Error("OpenAPI missing POST /sentinel/verify application/json schema");
  }
  const properties = Object.keys(schema.properties ?? {}).sort();
  const required = Array.isArray(schema.required)
    ? [...schema.required].map(String).sort()
    : [];
  return { properties, required };
}

export interface SentinelObjection {
  step_id?: string;
  criterion?: string;
  score?: number;
  predicate?: string;
  quote?: string | null;
  reasoning?: string;
}

export interface SentinelResponse {
  id: string;
  verdict: string;
  confidence?: number;
  reasoning?: string;
  objections?: SentinelObjection[];
  mode?: string;
  tier?: string;
  meta?: Record<string, unknown>;
}

export interface SentinelDecisionClientConfig {
  apiKey: string;
  url?: string;
  timeoutMs?: number;
  tier?: "checkpoint" | "standard";
  fetchImpl?: typeof fetch;
}

export type SentinelCallResult =
  | { ok: true; status: number; body: SentinelResponse }
  | { ok: false; status: number; error: string };

/** Collapse runs of whitespace so newline/spacing drift can be detected. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isBlankMandate(mandate: unknown): boolean {
  return String(mandate ?? "").trim().length === 0;
}

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && (ACTION_KINDS as readonly string[]).includes(value);
}

/** Accept a host kind only when it is an exact ActionKind after trim. */
export function parseActionKind(value: unknown): ActionKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return isActionKind(trimmed) ? trimmed : undefined;
}

/**
 * Non-empty host kind that is not a valid ActionKind.
 * Empty / omitted is not an error (undeclared).
 */
export function invalidHostKindReason(
  field: "mandate_kind" | "action_kind",
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  if (parseActionKind(value)) return undefined;
  const shown = typeof value === "string" ? value.trim() : typeof value;
  return `${field} must be one of ${ACTION_KINDS.join(" | ")} (got ${shown})`;
}

export function resolveHostDeclaredKinds(
  input: Pick<SentinelDecisionInput, "mandate_kind" | "action_kind">,
): HostDeclaredKinds {
  const out: HostDeclaredKinds = {};
  const mandateKind = parseActionKind(input.mandate_kind);
  const actionKind = parseActionKind(input.action_kind);
  if (mandateKind) out["mandate.kind"] = mandateKind;
  if (actionKind) out["action.kind"] = actionKind;
  return out;
}

/**
 * Cascade claim for `mode=action_authorization`.
 * Must assert authorization — never echo `proposed_action` alone
 * (thoughtproof-mcp#21 / Sentinel #36).
 */
export function buildActionAuthorizationClaim(proposedAction: string): string {
  const action = String(proposedAction ?? "").trim();
  return `${action}${ACTION_AUTHORIZATION_CLAIM_SUFFIX}`;
}

/**
 * Pick a provenance-valid quote of the user mandate.
 *
 * Host `quote` is used only when:
 *   1. it is at least {@link HOST_QUOTE_MIN_CHARS} characters after trim, and
 *   2. it is an exact substring of the trimmed mandate.
 *
 * Otherwise fall back to the full mandate. If the host quote fails exact
 * membership only because of collapsed newlines/whitespace, `fallbackReason`
 * is `whitespace_normalized_only` (still the full mandate — Sentinel must
 * see a verbatim mandate span).
 */
export function resolveMandateQuote(
  input: Pick<SentinelDecisionInput, "mandate" | "quote">,
): MandateQuoteResolution {
  const mandate = String(input.mandate ?? "").trim();
  const quote = String(input.quote ?? "").trim();

  if (!quote) {
    return { quote: mandate, usedHostQuote: false, fallbackReason: "omitted" };
  }
  if (quote.length < HOST_QUOTE_MIN_CHARS) {
    return { quote: mandate, usedHostQuote: false, fallbackReason: "too_short" };
  }
  if (mandate.includes(quote)) {
    return { quote, usedHostQuote: true };
  }
  if (collapseWhitespace(mandate).includes(collapseWhitespace(quote))) {
    return {
      quote: mandate,
      usedHostQuote: false,
      fallbackReason: "whitespace_normalized_only",
    };
  }
  return { quote: mandate, usedHostQuote: false, fallbackReason: "not_in_mandate" };
}

function quoteFallbackNote(reason: MandateQuoteFallbackReason | undefined): string | undefined {
  switch (reason) {
    case "too_short":
      return `[ThoughtProof quote] host quote rejected (too_short; floor is ${HOST_QUOTE_MIN_CHARS} characters); using full mandate for provenance.`;
    case "whitespace_normalized_only":
      return "[ThoughtProof quote] host quote matched mandate after whitespace collapse; using full mandate for provenance.";
    case "not_in_mandate":
      return "[ThoughtProof quote] host quote is not a substring of mandate; using full mandate for provenance.";
    default:
      return undefined;
  }
}

/**
 * @deprecated Evidence must not carry host-declared kinds (structural_fact-
 * class asymmetry). Kept as a constant only so older tests/imports fail
 * closed if they still search for the label — production evidence omits it.
 */
export const HOST_DECLARED_KINDS_LABEL = "Host-declared kinds:";

/** Suffix that turns proposed_action into an authorization assertion. */
export const ACTION_AUTHORIZATION_CLAIM_SUFFIX =
  " is authorized by the principal's mandate";

export interface HostDeclaredKinds {
  "mandate.kind"?: ActionKind;
  "action.kind"?: ActionKind;
}

export interface SentinelVerifyBody {
  claim: string;
  evidence: string;
  mode: "action_authorization";
  tier: "checkpoint" | "standard";
  /**
   * Present when the host declared `mandate.kind` and/or `action.kind`.
   * Live OpenAPI already allows top-level `mandate` (AuthorizationMandate).
   * Sentinel #51/#60 reads `mandate.kind` and nested `mandate.action.kind`
   * (MCP `action.kind` maps onto the latter). No top-level `action` field —
   * that is not on the live whitelist. Kinds are never echoed into evidence.
   */
  mandate?: {
    kind?: ActionKind;
    action?: { kind: ActionKind };
  };
}

/**
 * Evidence must carry mandate + proposed action + reasoning (Sentinel
 * action_authorization contract). The mandate quote is a contiguous span so
 * the cascade can cite it without PROV_FAIL_02 / PROVENANCE DOWNGRADE.
 */
export function buildSentinelEvidence(input: SentinelDecisionInput): string {
  const mandate = String(input.mandate ?? "").trim();
  const resolved = resolveMandateQuote(input);
  const parts: string[] = [];

  const note = quoteFallbackNote(resolved.fallbackReason);
  if (note) {
    parts.push(note, "");
  }

  if (resolved.quote !== mandate && mandate) {
    parts.push("User mandate:", mandate, "");
  }

  parts.push(
    "Principal mandate (verbatim quote):",
    resolved.quote,
    "",
    "Proposed action:",
    input.proposed_action,
    "",
    "Agent reasoning:",
    input.reasoning,
  );
  if (input.context) {
    parts.push("", "Context:", input.context);
  }
  // Host-declared kinds go on mandate.{kind,action.kind} only — never as
  // evidence prose (same asymmetry class as structural_fact / #34).
  return parts.join("\n");
}

/** Outbound /sentinel/verify body. No top-level `quote` (whitelist 400). */
export function buildSentinelVerifyBody(
  input: SentinelDecisionInput,
  tier: "checkpoint" | "standard" = "checkpoint",
): SentinelVerifyBody {
  const kinds = resolveHostDeclaredKinds(input);
  const body: SentinelVerifyBody = {
    claim: buildActionAuthorizationClaim(input.proposed_action),
    evidence: buildSentinelEvidence(input),
    mode: "action_authorization",
    tier,
  };
  if (kinds["mandate.kind"] || kinds["action.kind"]) {
    body.mandate = {};
    if (kinds["mandate.kind"]) {
      body.mandate.kind = kinds["mandate.kind"];
    }
    if (kinds["action.kind"]) {
      // Nested under mandate — Sentinel #60 reads mandate.action.kind.
      body.mandate.action = { kind: kinds["action.kind"] };
    }
  }
  return body;
}

export async function callSentinelDecision(
  input: SentinelDecisionInput,
  cfg: SentinelDecisionClientConfig,
): Promise<SentinelCallResult> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const url = cfg.url ?? SENTINEL_VERIFY_URL;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (isBlankMandate(input.mandate)) {
    return { ok: false, status: 0, error: "mandate is required (empty or whitespace-only)" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "thoughtproof-mcp/0.3.1",
    "X-Sentinel-Key": cfg.apiKey,
  };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildSentinelVerifyBody(input, cfg.tier ?? "checkpoint")),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, status: 0, error: `Sentinel timeout after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, error: `Sentinel network error: ${String(err)}` };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `Sentinel HTTP ${res.status}: ${text || res.statusText}`,
    };
  }

  try {
    const parsed = JSON.parse(text) as SentinelResponse;
    return { ok: true, status: res.status, body: parsed };
  } catch {
    return {
      ok: false,
      status: res.status,
      error: `Sentinel invalid JSON: ${text.slice(0, 300)}`,
    };
  }
}
