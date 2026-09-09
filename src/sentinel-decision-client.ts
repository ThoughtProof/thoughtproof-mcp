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
   * Used only when it is a substring of `mandate`; otherwise the full mandate
   * is the quote. Never forwarded as a top-level Sentinel body field.
   */
  quote?: string;
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

/**
 * Pick a provenance-valid quote of the user mandate.
 * Host quote wins only when it is a non-empty verbatim substring of mandate.
 */
export function resolveMandateQuote(input: Pick<SentinelDecisionInput, "mandate" | "quote">): string {
  const mandate = String(input.mandate ?? "").trim();
  const quote = String(input.quote ?? "").trim();
  if (quote && mandate.includes(quote)) return quote;
  return mandate;
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
  const quote = resolveMandateQuote(input);
  const parts: string[] = [];

  if (quote !== mandate && mandate) {
    parts.push("User mandate:", mandate, "");
  }

  parts.push(
    "Principal mandate (verbatim quote):",
    quote,
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
