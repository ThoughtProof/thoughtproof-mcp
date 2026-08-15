/**
 * Thin Sentinel client for verify_decision (not the verify_trade path).
 * POST https://sentinel.thoughtproof.ai/sentinel/verify
 * Auth: X-Sentinel-Key. No x402 in v1.
 * mode is OpenAPI-verified: action_authorization.
 */

export const SENTINEL_VERIFY_URL = "https://sentinel.thoughtproof.ai/sentinel/verify";
export const DEFAULT_TIMEOUT_MS = 90_000;

export interface SentinelDecisionInput {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
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

export function buildSentinelEvidence(input: SentinelDecisionInput): string {
  const parts = [`Mandate: ${input.mandate}`, "", "Reasoning:", input.reasoning];
  if (input.context) {
    parts.push("", "Context:", input.context);
  }
  return parts.join("\n");
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
      body: JSON.stringify({
        claim: input.proposed_action,
        evidence: buildSentinelEvidence(input),
        mode: "action_authorization",
        tier: cfg.tier ?? "checkpoint",
      }),
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
