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
export const DEFAULT_TIMEOUT_MS = 90_000;

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

/** Fields Sentinel /sentinel/verify accepts at body top level (strict whitelist). */
export const SENTINEL_VERIFY_BODY_FIELDS = [
  "id",
  "claim",
  "evidence",
  "mode",
  "tier",
  "mandate",
  "gateMode",
  "agent_context",
  "signed_evidence",
  "key_manifest",
  "required_conditions",
  "action_hash",
] as const;

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

export interface SentinelVerifyBody {
  claim: string;
  evidence: string;
  mode: "action_authorization";
  tier: "checkpoint" | "standard";
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
  return parts.join("\n");
}

/** Outbound /sentinel/verify body. No top-level `quote` (whitelist 400). */
export function buildSentinelVerifyBody(
  input: SentinelDecisionInput,
  tier: "checkpoint" | "standard" = "checkpoint",
): SentinelVerifyBody {
  return {
    claim: input.proposed_action,
    evidence: buildSentinelEvidence(input),
    mode: "action_authorization",
    tier,
  };
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
