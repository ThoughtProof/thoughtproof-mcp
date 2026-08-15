/**
 * Thin DQL client for verify_decision.
 * POST https://dql.thoughtproof.ai/dql/verify
 * Auth: X-DQL-Key for dqlk_…, or X-DQL-Account for dqla_… (never both).
 * Body is exact DqlRequest fields — sandbox is omitted unless a test flag is set.
 */

export const DQL_VERIFY_URL = "https://dql.thoughtproof.ai/dql/verify";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DQL_KEY_HEADER = "X-DQL-Key";
export const DQL_ACCOUNT_HEADER = "X-DQL-Account";

export type DqlAuthKind = "key" | "account";

export interface DqlAuth {
  kind: DqlAuthKind;
  value: string;
}

export interface DqlCredentialEnv {
  DQL_API_KEY?: string;
  THOUGHTPROOF_DQL_KEY?: string;
  DQL_ACCOUNT_TOKEN?: string;
}

function trimEnv(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Resolve DQL credentials from env-shaped input.
 * Prefer a dqlk_ verify key whenever one is set. Use a dqla_ account token
 * only when no dqlk_ is present. Never return both.
 */
export function resolveDqlCredential(env: DqlCredentialEnv = {}): DqlAuth | undefined {
  const apiKey = trimEnv(env.DQL_API_KEY);
  const aliasKey = trimEnv(env.THOUGHTPROOF_DQL_KEY);
  const accountToken = trimEnv(env.DQL_ACCOUNT_TOKEN);
  const candidates = [apiKey, aliasKey, accountToken].filter((v) => v.length > 0);

  const key = candidates.find((v) => v.startsWith("dqlk_"));
  if (key) return { kind: "key", value: key };

  const account = candidates.find((v) => v.startsWith("dqla_"));
  if (account) return { kind: "account", value: account };

  const legacy = apiKey || aliasKey;
  if (legacy) return { kind: "key", value: legacy };

  return undefined;
}

/** One credential header family only — never attach key + account together. */
export function buildDqlAuthHeaders(auth: DqlAuth): Record<string, string> {
  if (auth.kind === "account") {
    return {
      [DQL_ACCOUNT_HEADER]: auth.value,
      Authorization: `Bearer ${auth.value}`,
    };
  }
  return {
    [DQL_KEY_HEADER]: auth.value,
    Authorization: `Bearer ${auth.value}`,
  };
}

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
  auth: DqlAuth;
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
    "User-Agent": "thoughtproof-mcp/0.3.0",
    ...buildDqlAuthHeaders(cfg.auth),
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
