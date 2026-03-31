#!/usr/bin/env node
/**
 * ThoughtProof MCP Server
 *
 * Verify AI reasoning with adversarial multi-model consensus.
 * 4 LLMs (Grok, Gemini, DeepSeek, Sonnet) challenge each other.
 *
 * Tools:
 *   - verify_claim: Verify any claim or AI-generated reasoning
 *   - check_agent_score: Get an agent's trust score
 *
 * Usage:
 *   npx thoughtproof-mcp                          # stdio mode
 *   THOUGHTPROOF_API_KEY=tp_op_... npx thoughtproof-mcp  # with operator key
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.THOUGHTPROOF_BASE_URL || "https://api.thoughtproof.ai";
const API_KEY = process.env.THOUGHTPROOF_API_KEY || "";

// --- API Client ---

async function apiCall(path: string, body?: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "thoughtproof-mcp/0.1.0",
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
  version: "0.1.0",
});

// Tool 1: verify_claim
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

// --- Formatters ---

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
