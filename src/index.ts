#!/usr/bin/env node
/**
 * ThoughtProof MCP Server
 *
 * Verify AI reasoning with adversarial multi-model verification.
 * 3–4 LLMs evaluate independently → 1 red-team critic → 1 synthesizer.
 *
 * Tools:
 *   - verify_decision: Hero pre-execution gate. Routes internally to DQL
 *                      (spend/checkout) or Sentinel (irreversible exit).
 *                      Soft fail-closed: execute is true ONLY on ALLOW.
 *   - verify_claim: Verify any claim or AI-generated reasoning (RV /v1/check)
 *   - check_agent_score: Get an agent's trust score
 *   - verify_trade: Pre-execution gate for autonomous trading/action agents.
 *                   Full Sentinel → RV pipeline (powered by SERV Reasoning).
 *                   Returns ALLOW / BLOCK / UNCERTAIN + structured objections.
 *
 * Usage:
 *   npx thoughtproof-mcp                          # stdio mode
 *   THOUGHTPROOF_API_KEY=tp_op_... npx thoughtproof-mcp  # with operator key
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveDqlCredential } from "./dql-client.js";
import { verifyTrade, PaymentRequiredError } from "./verify-client.js";
import { verifyDecision } from "./verify-decision.js";

const API_BASE = process.env.THOUGHTPROOF_BASE_URL || "https://api.thoughtproof.ai";
const API_KEY = process.env.THOUGHTPROOF_API_KEY || "";

// --- API Client ---

async function apiCall(path: string, body?: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "thoughtproof-mcp/0.3.0",
  };
  if (API_KEY) {
    headers["X-Operator-Key"] = API_KEY;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 402) {
    // Parse the x402 discovery response for accurate pricing
    let details: any = {};
    try {
      details = await response.json();
    } catch {}

    const maxAmount = details?.accepts?.[0]?.maxAmountRequired;
    const priceUSD = maxAmount ? `$${(parseInt(maxAmount) / 1_000_000).toFixed(3)}` : "varies";

    return {
      error: "payment_required",
      message:
        "Verification requires payment via x402 (USDC on Base). " +
        (API_KEY
          ? "Your operator key may not have sufficient credits."
          : "Set THOUGHTPROOF_API_KEY environment variable for authenticated access."),
      pricing: {
        fast: "$0.008",
        standard: "$0.02",
        deep: "$0.08",
        thisRequest: priceUSD,
        payment: "x402 / USDC on Base",
        payTo: details?.accepts?.[0]?.payTo ?? "0xAB9f84864662f980614bD1453dB9950Ef2b82E83",
      },
      setup:
        "To use this tool, you need a ThoughtProof operator key.\n" +
        "1. Register at: POST https://api.thoughtproof.ai/v1/operators\n" +
        "2. Set: THOUGHTPROOF_API_KEY=tp_op_your_key\n" +
        "3. Restart the MCP server",
    };
  }

  if (response.status === 404) {
    return { error: "not_found", message: `Resource not found at ${path}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${text || response.statusText}`);
  }

  return response.json();
}

// --- MCP Server ---

const server = new McpServer({
  name: "thoughtproof",
  version: "0.3.0",
});

// Hero tool: verify_decision — DQL (default/spend) or Sentinel (irreversible exit).
// Does not call RV/PLV. Camera mandate: the agent must NOT put the overshoot
// in proposed_action or reasoning; the verifier has to find the mismatch.
server.tool(
  "verify_decision",
  "Pre-execution gate for a proposed agent action (hero tool). Routes internally to DQL or Sentinel and returns { verdict, execute, objections, receipt_id, surface, axes?, recommendation }. execute is true ONLY on ALLOW — on any other result treat this as do-not-execute (soft fail-closed; this tool does not hard-stop the host). Camera mandate: you must NOT put the overshoot or constraint violation in proposed_action or reasoning (for example, do not write \"price is above the cap\"). State the user's goal in mandate, the action you are about to take in proposed_action, and your own plan in reasoning. The verifier has to find the mismatch. Replan is a new call with a new receipt.",
  {
    mandate: z
      .string()
      .min(1)
      .describe("The user's stated goal or instruction the agent is acting on."),
    proposed_action: z
      .string()
      .min(1)
      .describe(
        "What the agent is about to do. Do not include the overshoot or constraint violation here (e.g. do not write \"price is above the cap\")."
      ),
    reasoning: z
      .string()
      .min(1)
      .describe(
        "The agent's own plan or reasoning. Do not include the overshoot or constraint violation here; the verifier has to find the mismatch."
      ),
    context: z
      .string()
      .optional()
      .describe("Optional extra evidence, tool outputs, or prior turns."),
    mode: z
      .enum(["dql", "sentinel", "auto"])
      .optional()
      .describe(
        "Routing override. auto (default) picks DQL for spend/checkout language and Sentinel for high-blast irreversible exits; unsure → DQL. Explicit mode wins. RV/PLV are not available."
      ),
  },
  async ({ mandate, proposed_action, reasoning, context, mode }) => {
    const envelope = await verifyDecision(
      { mandate, proposed_action, reasoning, context, mode },
      {
        dqlAuth: resolveDqlCredential(process.env),
        sentinelApiKey: process.env.SENTINEL_API_KEY || process.env.THOUGHTPROOF_API_KEY,
        sandbox: process.env.DQL_SANDBOX === "1",
      }
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
    };
  }
);

// Tool: verify_claim (RV /v1/check) — unchanged.
server.tool(
  "verify_claim",
  {
    claim: z.string().min(1).describe(
      "The claim or AI-generated reasoning to verify. Can be a statement, decision, analysis, or any text that needs adversarial verification."
    ),
    stakeLevel: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Risk level — higher stakes trigger more thorough verification. Default: medium"),
    domain: z
      .enum(["financial", "medical", "legal", "code", "general"])
      .optional()
      .describe("Domain context for specialized verification. Default: general"),
    speed: z
      .enum(["fast", "standard", "deep"])
      .optional()
      .describe(
        "Verification depth. fast=$0.008 (2 models), standard=$0.02 (4 models), deep=$0.08 (5+ models). Default: standard"
      ),
  },
  async ({ claim, stakeLevel, domain, speed }) => {
    const result = await apiCall("/v1/check", {
      claim,
      stakeLevel: stakeLevel ?? "medium",
      domain: domain ?? "general",
      speed: speed ?? "standard",
    });

    if (result.error === "payment_required") {
      return {
        content: [
          {
            type: "text" as const,
            text: formatPaymentRequired(result),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatVerdict(result, claim),
        },
      ],
    };
  }
);

// Tool 2: check_agent_score
server.tool(
  "check_agent_score",
  {
    agentId: z.string().min(1).describe("The agent ID to look up (e.g. 'agent_abc123xyz')"),
    domain: z.string().optional().describe("Optional domain filter for the score"),
  },
  async ({ agentId, domain }) => {
    const params = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const result = await apiCall(`/v1/agents/${encodeURIComponent(agentId)}/score${params}`);

    return {
      content: [
        {
          type: "text" as const,
          text: formatAgentScore(result, agentId),
        },
      ],
    };
  }
);

// Tool 3: verify_trade — pre-execution gate for autonomous trading/action agents.
// Full Sentinel → RV pipeline (SERV Reasoning panel). This is the tool the
// Coinbase agent stack / CB4A calls before executing a trade.
server.tool(
  "verify_trade",
  {
    action: z
      .string()
      .min(1)
      .describe(
        "The action the agent intends to execute, e.g. 'open 5x long BTC, 8000 USDC margin' or 'swap 10 ETH for USDC'."
      ),
    thesis: z
      .string()
      .min(1)
      .describe("The agent's one-line decisive rationale for the action."),
    reasoning: z
      .string()
      .min(1)
      .describe(
        "The full reasoning chain that produced the decision — the actual chain of thought, not a summary. This is what ThoughtProof verifies."
      ),
    situation: z
      .string()
      .optional()
      .describe(
        "Optional market/context snapshot WITHOUT the chosen action. Lets the adversarial panel form an independent view before seeing the decision (stronger verification)."
      ),
    stakeLevel: z
      .enum(["micro", "low", "medium", "high", "critical"])
      .optional()
      .describe(
        "Stake level — drives the verdict threshold. Higher stake demands higher reasoning soundness to ALLOW: the SAME decision can ALLOW at low stake and BLOCK/UNCERTAIN at critical stake. Default 'high' (suitable for leveraged capital). 'micro' runs the fast Sentinel-only gate; everything else runs the full Sentinel→RV adversarial pipeline."
      ),
  },
  async ({ action, thesis, reasoning, situation, stakeLevel }) => {
    try {
      const result = await verifyTrade(
        { action, thesis, reasoning, situation, stakeLevel },
        {
          apiKey: API_KEY || undefined,
          x402PaymentSignature: process.env.THOUGHTPROOF_X402_PAYSIG,
          sentinelTier:
            (process.env.SENTINEL_TIER as "checkpoint" | "standard" | undefined) ?? "checkpoint",
        }
      );
      return {
        content: [{ type: "text" as const, text: formatTradeVerdict(result, action) }],
      };
    } catch (err) {
      if (err instanceof PaymentRequiredError) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `⚠️ **Payment Required (x402)**\n\n${err.message}\n\n` +
                `Set THOUGHTPROOF_API_KEY to bypass, or supply THOUGHTPROOF_X402_PAYSIG with a settled payment payload.`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: `⚠️ Verification error: ${String(err)}` }],
      };
    }
  }
);

// --- Formatters ---

function formatTradeVerdict(
  result: import("./verify-client.js").VerifyTradeResult,
  action: string
): string {
  const icon =
    result.verdict === "ALLOW" ? "✅" : result.verdict === "BLOCK" ? "❌" : "⚠️";
  let out = `${icon} **${result.verdict}**\n\n`;
  out += `**Action:** ${action.length > 200 ? action.slice(0, 200) + "..." : action}\n`;
  out += `**Recommendation:** ${result.recommendation}\n`;

  if (result.objections.length > 0) {
    out += `\n**Objections (reason about these before acting):**\n`;
    for (const o of result.objections) {
      out += `- [${o.severity}] ${o.explanation}\n`;
    }
  } else {
    out += `\nNo objections raised.\n`;
  }

  out += `\n_Route: ${result.route}`;
  if (result.rv?.modelCount) out += ` · ${result.rv.modelCount}-model adversarial panel`;
  out += ` · ${(result.latencyMs / 1000).toFixed(1)}s_`;

  const anchors: string[] = [];
  if (result.attestation.sentinelClaimHash)
    anchors.push(`sentinel:${result.attestation.sentinelClaimHash.slice(0, 18)}…`);
  if (result.attestation.rvSignature)
    anchors.push(`rv-sig:${result.attestation.rvSignature.slice(0, 18)}…`);
  if (anchors.length) out += `\n_Attestation: ${anchors.join(" · ")}_`;

  if (result.payment && result.payment.method !== "none" && result.payment.method !== "api-key") {
    out += `\n_Paid via ${result.payment.method}`;
    if (result.payment.txHash) out += ` (${result.payment.txHash.slice(0, 18)}…)`;
    out += `_`;
  }

  return out;
}

function formatVerdict(result: any, claim: string): string {
  const verdict = result.verdict ?? "UNKNOWN";
  const confidence = result.confidence != null ? Math.round(result.confidence * 100) : "?";
  const objections = result.objections ?? [];
  const duration = result.durationMs ? (result.durationMs / 1000).toFixed(1) + "s" : "?";

  const icon = verdict === "ALLOW" ? "✅" : verdict === "BLOCK" ? "❌" : "⚠️";

  let output = `${icon} **${verdict}** (${confidence}% confidence)\n\n`;
  output += `**Claim:** "${claim.length > 200 ? claim.slice(0, 200) + "..." : claim}"\n\n`;

  if (objections.length > 0) {
    output += `**Objections:**\n`;
    for (const obj of objections) {
      output += `- ${obj}\n`;
    }
    output += "\n";
  }

  output += `⚡ ${duration} | Adversarial Multi-Model Consensus`;

  return output;
}

function formatAgentScore(result: any, agentId: string): string {
  if (result.error === "not_found") {
    return `❌ Agent **${agentId}** not found.\n\nMake sure the agent ID is correct. Agents must be registered via POST /v1/agents first.`;
  }
  if (result.error) {
    return `⚠️ Error looking up agent ${agentId}: ${result.message ?? result.error}`;
  }

  const score = result.score?.composite;
  const events = result.eventCount ?? 0;

  let output = `**Agent Trust Score: ${agentId}**\n\n`;
  output += `Score: ${score != null ? (score * 100).toFixed(1) + "%" : "No data"}\n`;
  output += `Events: ${events}\n`;

  return output;
}

function formatPaymentRequired(result: any): string {
  let output = `⚠️ **Payment Required**\n\n`;
  output += `${result.message}\n\n`;
  output += `**Pricing:**\n`;
  output += `- Fast (2 models): ${result.pricing.fast}\n`;
  output += `- Standard (4 models): ${result.pricing.standard}\n`;
  output += `- Deep (5+ models): ${result.pricing.deep}\n`;
  if (result.pricing.thisRequest) {
    output += `- This request: ${result.pricing.thisRequest}\n`;
  }
  output += `- Payment: ${result.pricing.payment}\n`;
  if (result.setup) {
    output += `\n**Setup:**\n${result.setup}\n`;
  }
  return output;
}

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[thoughtproof-mcp] Server started. Waiting for connections...");
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err) => {
  console.error("[thoughtproof-mcp] Fatal:", err);
  process.exit(1);
});
