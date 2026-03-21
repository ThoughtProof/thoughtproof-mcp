# @thoughtproof/mcp-server

MCP server that exposes ThoughtProof reasoning verification as a tool for Claude, Cursor, and any MCP-compatible host.

ThoughtProof runs adversarial multi-model critique on a claim and returns a verdict (`ALLOW` / `HOLD` / `UNCERTAIN` / `DISSENT`), a confidence score, and up to 3 key objections.

[![thoughtproof-mcp MCP server](https://glama.ai/mcp/servers/ThoughtProof/thoughtproof-mcp/badges/card.svg)](https://glama.ai/mcp/servers/ThoughtProof/thoughtproof-mcp)

## Install

```bash
npx @thoughtproof/mcp-server
```

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "npx",
      "args": ["-y", "@thoughtproof/mcp-server"]
    }
  }
}
```

## Example

**User:** Verify this trade: "Buy 50k USDC of ARB/USDC at market, stop-loss at -8%, no hedge."

**Claude calls `verify_reasoning`:**
```json
{
  "claim": "Buy 50k USDC of ARB/USDC at market, stop-loss at -8%, no hedge.",
  "stakeLevel": "high",
  "domain": "financial"
}
```

**Tool response:**
```
Verdict: HOLD
Confidence: 41.2%

Key objections:
1. Market-order entry on low-liquidity pair risks significant slippage on a $50k position.
2. -8% stop-loss is within normal daily volatility for ARB; likely to be triggered without a directional move.
3. No hedge leaves full downside exposure during high-beta drawdowns.

Verified in 18432ms
```

## Payment (x402)

ThoughtProof charges per verification via the [x402 protocol](https://x402.org) (Base USDC). If payment is not attached the tool returns a clear `paymentRequired` message with wallet and amount details.