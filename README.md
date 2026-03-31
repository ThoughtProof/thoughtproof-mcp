# thoughtproof-mcp

MCP server for [ThoughtProof](https://thoughtproof.ai) — verify AI reasoning with adversarial multi-model consensus.

4 LLMs (Grok, Gemini, DeepSeek, Sonnet) challenge each other on every claim. Returns **ALLOW**, **BLOCK**, or **UNCERTAIN** with confidence score and objections.

## Tools

### `verify_claim`

Verify any claim or AI-generated reasoning before acting on it.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `claim` | string | (required) | The text to verify |
| `stakeLevel` | low / medium / high / critical | medium | Risk level |
| `domain` | financial / medical / legal / code / general | general | Domain context |
| `speed` | fast / standard / deep | standard | Verification depth |

### `check_agent_score`

Look up an agent's composite trust score.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | string | Agent ID to look up |
| `domain` | string | Optional domain filter |

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

### Cursor

Add to Cursor's MCP settings:

```json
{
  "thoughtproof": {
    "command": "npx",
    "args": ["-y", "thoughtproof-mcp"],
    "env": {
      "THOUGHTPROOF_API_KEY": "tp_op_your_key_here"
    }
  }
}
```

### Windsurf / Cline

Same pattern — point to `npx thoughtproof-mcp` with the env var.

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

## API Key

Get an operator API key at [thoughtproof.ai](https://thoughtproof.ai). Without a key, verifications require x402 micropayment (USDC on Base).

## Pricing

| Speed | Models | Price |
|-------|--------|-------|
| fast | 2 | $0.008 |
| standard | 4 | $0.02 |
| deep | 5+ | $0.08 |

## Development

```bash
npm install
npm run dev          # Run with tsx
npm run inspect      # Test with MCP Inspector
npm run build        # Compile TypeScript
```

## License

MIT — [ThoughtProof](https://thoughtproof.ai)
