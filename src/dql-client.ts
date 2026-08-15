/**
 * Thin DQL client for verify_decision.
 * POST https://dql.thoughtproof.ai/dql/verify
 * Auth: X-DQL-Key (backend also accepts Authorization: Bearer dqlk_…).
 * Body is exact DqlRequest fields — sandbox is omitted unless a test flag is set.
 */

export const DQL_VERIFY_URL = "https://dql.thoughtproof.ai/dql/verify";
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface DqlRequest {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
  sandbox?: boolean;
}

export interface DqlAxisResult {
  axis: string;
  verdict: string;
  confidence?: number;
  reasoning?: string;
  objection: string;
}

export interface DqlAggregate {
  verdict: string;
  confidence?: number;
  triggered_by?: string[];
  rationale?: string;
}

export interface DqlResponse {
  id: string;
  version?: string;
  axes: DqlAxisResult[];
  aggregate: DqlAggregate;
  meta?: Record<string, unknown>;
}

export interface DqlClientConfig {
  apiKey: string;
  url?: string;
  timeoutMs?: number;
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
}

export type DqlCallResult =
  | { ok: true; status: number; body: DqlResponse }
  | { ok: false; status: number; error: string };

export async function callDql(
  input: Omit<DqlRequest, "sandbox">,
  cfg: DqlClientConfig,
): Promise<DqlCallResult> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const url = cfg.url ?? DQL_VERIFY_URL;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body: DqlRequest = {
    mandate: input.mandate,
    proposed_action: input.proposed_action,
    reasoning: input.reasoning,
  };
  if (input.context) body.context = input.context;
  if (cfg.sandbox) body.sandbox = true;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "thoughtproof-mcp/0.2.1",
    "X-DQL-Key": cfg.apiKey,
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, status: 0, error: `DQL timeout after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, error: `DQL network error: ${String(err)}` };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `DQL HTTP ${res.status}: ${text || res.statusText}`,
    };
  }

  try {
    const parsed = JSON.parse(text) as DqlResponse;
    return { ok: true, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: res.status, error: `DQL invalid JSON: ${text.slice(0, 300)}` };
  }
}
