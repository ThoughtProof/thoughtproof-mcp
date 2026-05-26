# thoughtproof-mcp

[![npm version](https://img.shields.io/npm/v/thoughtproof-mcp.svg)](https://www.npmjs.com/package/thoughtproof-mcp)
[![CI](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [ThoughtProof](https://thoughtproof.ai) — verify AI reasoning with adversarial multi-model consensus.

4 LLMs (Grok, Gemini, DeepSeek, Sonnet) challenge each other on every claim. Returns **ALLOW**, **BLOCK**, or **UNCERTAIN** with confidence score and objections.

## Quick Start

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "npx",
      "args": ["-y", "thoughtproof-mcp"],
      "env": {
        "THOUGHTPROOF_API_KEY": "tp_op_your_key_here"
      }
    }
  }
}
```

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, and any MCP-compatible client.

## Tools

### `verify_claim`

Verify any claim or AI-generated reasoning before acting on it.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `claim` | string | *(required)* | The text to verify |
| `stakeLevel` | `low` / `medium` / `high` / `critical` | `medium` | Risk level — higher stakes trigger deeper verification |
| `domain` | `financial` / `medical` / `legal` / `code` / `general` | `general` | Domain context for specialized verification |
| `speed` | `fast` / `standard` / `deep` | `standard` | Verification depth |

### `check_agent_score`

Look up an agent's composite trust score on the ERC-8004 registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | string | Agent ID to look up |
| `domain` | string | Optional domain filter |

## Example

In Claude Desktop or Cursor, just ask:

> "Verify the claim: GPT-5 achieves 95% accuracy on MMLU-Pro"

The tool returns:

```
⚠️ UNCERTAIN (42% confidence)

Claim: "GPT-5 achieves 95% accuracy on MMLU-Pro"

Objections:
- Insufficient public benchmark data to confirm
- Historical accuracy claims have been overstated
- MMLU-Pro methodology has known ceiling effects

⚡ 3.2s | Adversarial Multi-Model Consensus
```

## How It Works

```
Your AI Agent
    │
    ▼
┌──────────────────┐
│  thoughtproof-mcp │  ← MCP Server (this package)
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  ThoughtProof API │  ← api.thoughtproof.ai
└──────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│  4 Independent LLMs (adversarial)    │
│  Grok · Gemini · DeepSeek · Sonnet   │
│  Each challenges the claim separately │
└──────────────────────────────────────┘
    │
    ▼
  ALLOW / BLOCK / UNCERTAIN
  + confidence % + objections
```

## Pricing

| Speed | Models | Cost per verification |
|-------|--------|-----------------------|
| fast | 2 | $0.008 |
| standard | 4 | $0.02 |
| deep | 5+ | $0.08 |

Payment: API key (operator account) or x402 micropayment (USDC on Base).

## API Key

Get an operator API key at [thoughtproof.ai](https://thoughtproof.ai). Without a key, verifications use x402 micropayments automatically.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `THOUGHTPROOF_API_KEY` | *(none)* | Operator API key |
| `THOUGHTPROOF_BASE_URL` | `https://api.thoughtproof.ai` | API base URL |

## Development

```bash
git clone https://github.com/ThoughtProof/thoughtproof-mcp.git
cd thoughtproof-mcp
npm install
npm run build
npm test
npm run dev          # Run with tsx (hot reload)
npm run inspect      # Test with MCP Inspector
```

## Related

- [ThoughtProof](https://thoughtproof.ai) — Decision verification for AI agents
- [pot-cli](https://github.com/ThoughtProof/pot-cli) — CLI for reasoning verification
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Autonomous Agent Registry

## License

MIT — [ThoughtProof](https://thoughtproof.ai)
