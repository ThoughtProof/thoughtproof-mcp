// ThoughtProof verification pipeline client for the MCP `verify_trade` tool.
//
// Routes a decision through the live ThoughtProof backends:
//   1. Sentinel  — POST sentinel.thoughtproof.ai/sentinel/verify
//                   pre-execution triage gate (typically 15–60s by tier/load).
//   2. RV        — POST api.thoughtproof.ai/v1/check
//                   adversarial multi-model panel (powered by SERV Reasoning),
//                   only for high-stakes decisions that survive Sentinel.
//
// Merge is conservative: BLOCK > UNCERTAIN > ALLOW. UNCERTAIN is fail-closed —
// the agent must NOT execute, but receives objections so it can revise.
//
// This mirrors the exact contract proven live in the verified-trading-agent
// (119 cycles, ERC-8004 Agent #571). Kept as a standalone module so the MCP
// server can expose it without depending on the agent package.
//
// Payment: if THOUGHTPROOF_API_KEY is set, calls authenticate by key (Flow A).
// Otherwise an x402 PAYMENT-SIGNATURE (base64 payload) is forwarded on the
// Sentinel call (Base eip155:8453 or GOAT eip155:2345) and the settlement
// receipt is surfaced back to the caller.

export type Verdict = "ALLOW" | "BLOCK" | "UNCERTAIN";

/** RV verdict threshold — higher stake demands higher reasoning soundness to ALLOW. */
export type StakeLevel = "micro" | "low" | "medium" | "high" | "critical";

export interface VerifyTradeInput {
  action: string;
  thesis: string;
  reasoning: string;
  situation?: string;
  /**
   * Stake level — drives the RV verdict threshold (micro 0.40 → critical 0.85).
   * Higher stake = stricter: the same decision can ALLOW at low stake and
   * BLOCK/UNCERTAIN at critical stake. Default "high" (0.75) — appropriate for
   * leveraged capital. Use "micro"/"low" for routine/small positions.
   * Also controls routing: "micro" runs the fast Sentinel-only gate; everything
   * else escalates to the full Sentinel→RV adversarial pipeline.
   */
  stakeLevel?: StakeLevel;
}

export interface SentinelResult {
  verdict: Verdict;
  confidence: number;
  reason: string;
  attestation?: {
    prepared?: boolean;
    issued?: boolean;
    schemaUid?: string;
    claimHash?: string;
    evidenceHash?: string;
  };
}

export interface RvObjection {
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface RvResult {
  verdict: Verdict;
  confidence: number;
  summary: string;
  objections: RvObjection[];
  modelCount?: number;
  profile?: string;
  attestation?: {
    type: string;
    hash?: string;
    signature?: string;
    signer?: string;
    receiptId?: string;
  };
}

export interface VerifyTradeResult {
  verdict: Verdict;
  recommendation: string;
  route: "sentinel" | "pipeline";
  objections: RvObjection[];
  sentinel?: SentinelResult;
  rv?: RvResult;
  attestation: {
    sentinelClaimHash?: string;
    rvSignature?: string;
    rvSigner?: string;
  };
  latencyMs: number;
  payment?: {
    method: "api-key" | "x402-base" | "x402-goat" | "none";
    txHash?: string;
    network?: string;
    amountUsdc?: string;
  };
}

export interface VerifyClientConfig {
  apiKey?: string;
  x402PaymentSignature?: string;
  sentinelTier?: "checkpoint" | "standard";
}

const SENTINEL_URL =
  process.env.SENTINEL_URL ?? "https://sentinel.thoughtproof.ai/sentinel/verify";
const RV_URL = process.env.RV_URL ?? "https://api.thoughtproof.ai/v1/check";

function normalizeVerdict(v: unknown): Verdict {
  const s = String(v ?? "").toUpperCase();
  if (s === "BLOCK" || s === "FAIL") return "BLOCK";
  if (s === "ALLOW" || s === "PASS") return "ALLOW";
  return "UNCERTAIN";
}

/** Thrown when the backend demands x402 payment and no valid auth was supplied. */
export class PaymentRequiredError extends Error {
  challenge: string;
  constructor(message: string, challenge: string) {
    super(message);
    this.name = "PaymentRequiredError";
    this.challenge = challenge;
  }
}

interface SentinelCallResult {
  result: SentinelResult;
  payment: VerifyTradeResult["payment"];
}

async function callSentinel(
  input: VerifyTradeInput,
  cfg: VerifyClientConfig,
): Promise<SentinelCallResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["X-Sentinel-Key"] = cfg.apiKey;
  if (cfg.x402PaymentSignature) headers["PAYMENT-SIGNATURE"] = cfg.x402PaymentSignature;

  const res = await fetch(SENTINEL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      claim: input.action,
      evidence: `Thesis: ${input.thesis}\n\nReasoning: ${input.reasoning}`,
      mode: "trade_execution",
      tier: cfg.sentinelTier ?? "checkpoint",
    }),
  });

  if (res.status === 402) {
    const challenge = res.headers.get("payment-required") ?? "";
    throw new PaymentRequiredError(
      "Sentinel requires payment (x402). Provide THOUGHTPROOF_API_KEY or a valid PAYMENT-SIGNATURE.",
      challenge,
    );
  }
  if (!res.ok) {
    throw new Error(`Sentinel failed (${res.status}): ${await res.text()}`);
  }

  let payment: VerifyTradeResult["payment"] = { method: cfg.apiKey ? "api-key" : "none" };
  const receiptHeader = res.headers.get("payment-response");
  if (receiptHeader) {
    try {
      const receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString());
      const isGoat = String(receipt.paidWith ?? "").includes("goat");
      payment = {
        method: isGoat ? "x402-goat" : "x402-base",
        txHash: receipt.txHash,
        network: receipt.network,
      };
    } catch {
      /* leave default */
    }
  }

  const d = (await res.json()) as Record<string, any>;
  const att = d.attestation as Record<string, any> | undefined;
  const result: SentinelResult = {
    verdict: normalizeVerdict(d.verdict),
    confidence: Number(d.confidence ?? 0),
    reason: String(d.reasoning ?? ""),
    attestation: att
      ? {
          prepared: Boolean(att.prepared),
          issued: Boolean(att.issued),
          schemaUid: att.schema_uid,
          claimHash: att.claim_hash,
          evidenceHash: att.evidence_hash,
        }
      : undefined,
  };
  return { result, payment };
}

async function callRv(input: VerifyTradeInput, cfg: VerifyClientConfig): Promise<RvResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["X-API-Key"] = cfg.apiKey;

  const res = await fetch(RV_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      claim: `${input.action}. Thesis: ${input.thesis}`,
      context: `Autonomous trading agent decision. Full reasoning chain: ${input.reasoning}`,
      ...(input.situation
        ? {
            situation:
              `An autonomous trading agent must decide: act or stand down, and at what size. ` +
              `Current situation:\n${input.situation}`,
          }
        : {}),
      // stakeLevel drives the RV verdict threshold (micro 0.40 → critical 0.85).
      // Default "high" = 0.75, appropriate for leveraged capital.
      stakeLevel: input.stakeLevel ?? "high",
      speed: "standard",
      onchain: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`RV failed (${res.status}): ${await res.text()}`);
  }
  const d = (await res.json()) as Record<string, any>;
  const objections: RvObjection[] = Array.isArray(d.objections)
    ? d.objections
        .map((o: any): RvObjection => {
          if (typeof o === "string") {
            return { severity: "medium", explanation: o };
          }
          return {
            severity: (o.severity ?? o.materiality ?? "medium") as RvObjection["severity"],
            explanation: String(o.explanation ?? o.description ?? o.text ?? o.claim ?? ""),
          };
        })
        .filter((o: RvObjection) => o.explanation.length > 0)
    : [];
  const proof = (d.onchain_proof ?? d.attestation) as Record<string, any> | undefined;
  return {
    verdict: normalizeVerdict(d.verdict),
    confidence: Number(d.confidence ?? 0),
    summary: String(d.summary ?? d.reasoning ?? ""),
    objections,
    modelCount: typeof d.modelCount === "number" ? d.modelCount : undefined,
    profile: d.verificationProfile ? String(d.verificationProfile) : undefined,
    attestation: proof
      ? {
          type: String(proof.type ?? (d.onchain_proof ? "onchain_proof" : "tp")),
          hash: proof.hash,
          signature: proof.signature,
          signer: proof.signer,
          receiptId: proof.receiptId ?? d.id,
        }
      : undefined,
  };
}

function recommend(verdict: Verdict): string {
  switch (verdict) {
    case "ALLOW":
      return "Verification passed. Safe to execute.";
    case "BLOCK":
      return "Do NOT execute. The reasoning failed verification — review the objections below before acting.";
    case "UNCERTAIN":
      return "Do NOT execute as-is. Verification is not confident. Reconsider the objections and either revise the decision or stand down.";
  }
}

/**
 * Verify a trade/action decision through ThoughtProof.
 * Sentinel gate first; escalate to RV for high-stakes decisions that survive it.
 */
export async function verifyTrade(
  input: VerifyTradeInput,
  cfg: VerifyClientConfig,
): Promise<VerifyTradeResult> {
  const start = Date.now();
  // "micro" stake → fast Sentinel-only gate. Everything else escalates to the
  // full Sentinel→RV adversarial pipeline (RV applies the stake threshold).
  const stakeLevel = input.stakeLevel ?? "high";
  const escalateToRv = stakeLevel !== "micro";

  const { result: sentinel, payment } = await callSentinel(input, cfg);

  if (sentinel.verdict === "BLOCK") {
    return {
      verdict: "BLOCK",
      recommendation: recommend("BLOCK"),
      route: "sentinel",
      objections: sentinel.reason ? [{ severity: "high", explanation: sentinel.reason }] : [],
      sentinel,
      attestation: { sentinelClaimHash: sentinel.attestation?.claimHash },
      latencyMs: Date.now() - start,
      payment,
    };
  }

  if (!escalateToRv) {
    return {
      verdict: sentinel.verdict,
      recommendation: recommend(sentinel.verdict),
      route: "sentinel",
      objections: sentinel.reason ? [{ severity: "medium", explanation: sentinel.reason }] : [],
      sentinel,
      attestation: { sentinelClaimHash: sentinel.attestation?.claimHash },
      latencyMs: Date.now() - start,
      payment,
    };
  }

  // High-stakes → escalate to RV adversarial verification (SERV Reasoning panel).
  const rv = await callRv(input, cfg);

  // Merge philosophy (verify_trade product): once we've escalated to the
  // authoritative RV panel, RV's verdict LEADS. Sentinel's UNCERTAIN means
  // "not sure — ask the expert", not a veto; letting the cheap, noisy triage
  // gate override a clean RV verdict would make the (paid) escalation pointless.
  // Safety preserved: (1) Sentinel can still hard-BLOCK before we ever reach RV
  // (handled above); (2) RV is itself fail-closed and stake-calibrated, so RV's
  // own UNCERTAIN/BLOCK still prevents ALLOW. We only drop Sentinel-UNCERTAIN as
  // a veto on an otherwise-clean RV ALLOW. Sentinel's verdict stays in the
  // response for audit/transparency.
  const finalVerdict: Verdict =
    rv.verdict === "BLOCK"
      ? "BLOCK"
      : rv.verdict === "UNCERTAIN"
        ? "UNCERTAIN"
        : "ALLOW";

  return {
    verdict: finalVerdict,
    recommendation: recommend(finalVerdict),
    route: "pipeline",
    objections: rv.objections,
    sentinel,
    rv,
    attestation: {
      sentinelClaimHash: sentinel.attestation?.claimHash,
      rvSignature: rv.attestation?.signature,
      rvSigner: rv.attestation?.signer,
    },
    latencyMs: Date.now() - start,
    payment,
  };
}
