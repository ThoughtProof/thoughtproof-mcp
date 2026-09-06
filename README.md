# thoughtproof-mcp

[![npm version](https://img.shields.io/npm/v/thoughtproof-mcp.svg)](https://www.npmjs.com/package/thoughtproof-mcp)
[![CI](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml)
[![HOL Guard Scanner](https://img.shields.io/badge/HOL%20Guard-scanner-00a67e)](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/hol-scanner.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

thoughtproof-mcp — local stdio. Hero tool `verify_decision` (DQL spend / Sentinel irreversible exit). `execute` is `true` only on ALLOW.

MCP server for [ThoughtProof](https://thoughtproof.ai) — pre-execution decision verification for AI agents.

**Hero tool:** `verify_decision`. It routes inside the tool to DQL (spend / checkout) or Sentinel (irreversible exit) and returns a fail-closed `execute` flag. `execute` is `true` only on a native `ALLOW`.

This package is a **local stdio** MCP server (Node 18+) for Desktop / CLI hosts such as Cursor, Claude Desktop, Windsurf, and Cline. It is **not** a remote HTTP MCP server. It is **not** a Grok Web/Mobile custom connector.

Get keys at [https://app.thoughtproof.ai/pricing](https://app.thoughtproof.ai/pricing).

Unpublished work is documented in [UNRELEASED.md](./UNRELEASED.md).

## Quick Start

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "npx",
      "args": ["-y", "thoughtproof-mcp@0.3.2"],
      "env": {
        "DQL_API_KEY": "dqlk_your_key_here"
      }
    }
  }
}
```

Install with `npx -y thoughtproof-mcp@0.3.2`. Works with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, and other local stdio MCP clients.

## Tools

### `verify_before_action` / `verify_decision` (hero)

`verify_before_action` is an alias of `verify_decision` (identical schema + handler). Soft fail-closed: host must honor `execute=false`.

Pre-execution gate for a proposed action. Routing is inside the tool — not an agent quiz.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mandate` | string | *(required)* | User's stated goal / instruction |
| `proposed_action` | string | *(required)* | What the agent is about to do |
| `reasoning` | string | *(required)* | The agent's own plan / reasoning |
| `context` | string | *(optional)* | Extra evidence |
| `mode` | `dql` / `sentinel` / `auto` | `auto` | Explicit surface, or auto-route |

**Auto-route:** spend / checkout / booking / purchase / payment / cart / Stripe / price / budget / cap → DQL. High-blast irreversible exit without that language (publish, delete, deploy, send-to-prod, memory write) → Sentinel. Unsure → DQL. Explicit `mode` wins. RV / PLV are not on this path.

**Camera mandate:** do **not** put the overshoot in `proposed_action` or `reasoning` (for example, do not write “price is above the cap”). The verifier has to find the mismatch.

**Envelope** (always this shape):

```json
{
  "verdict": "ALLOW",
  "execute": true,
  "objections": [],
  "receipt_id": "dql_…",
  "surface": "dql",
  "axes": [],
  "recommendation": "execute"
}
```

`execute` is `true` only on `ALLOW`. `REVIEW`, `UNCERTAIN`, `BLOCK`, timeouts, HTTP 402/4xx/5xx, and missing keys return `execute: false`. Fail-closed is soft at the protocol layer — the tool does not hard-stop the host. Replan is a new call (new receipt).

### `verify_claim`

Verify any claim or AI-generated reasoning via RV (`POST /v1/check`). Unchanged.

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

### `verify_trade`

Optional pre-execution gate for trading agents (Sentinel → RV). Not the default `verify_decision` path. See [VERIFY_TRADE.md](./VERIFY_TRADE.md).

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DQL_API_KEY` | *(none)* | DQL key (`dqlk_…`) for the default `verify_decision` path. Alias: `THOUGHTPROOF_DQL_KEY` |
| `SENTINEL_API_KEY` | *(none)* | Optional. Required only when `mode=sentinel` or auto-route picks Sentinel. Fallback: `THOUGHTPROOF_API_KEY` as `X-Sentinel-Key` |
| `DQL_SANDBOX` | *(off)* | Set to `1` to send `sandbox: true` on DQL calls (local/dev only) |
| `THOUGHTPROOF_API_KEY` | *(none)* | Operator key for `verify_claim` / `verify_trade` / Sentinel fallback |
| `THOUGHTPROOF_BASE_URL` | `https://api.thoughtproof.ai` | RV API base URL (`verify_claim`) |

A missing Sentinel key returns `execute: false` with “Sentinel key not configured” — it does not silently call DQL.

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

For local MCP clients, point `command` at `node` and `args` at `dist/index.js` after `npm run build`.

## Security

See [SECURITY.md](./SECURITY.md) for supported versions, private reporting (`security@thoughtproof.ai`), and key handling (`dqlk_…` for MCP hero — never commit real keys).

HOL listing / Guard scanner score is a **review baseline only**. It is **not** next-action authorization and not a substitute for fail-closed host behavior (`execute: true` only on ALLOW).

## Related

- [ThoughtProof](https://thoughtproof.ai) — Decision verification for AI agents
- [pot-cli](https://github.com/ThoughtProof/pot-cli) — CLI for reasoning verification
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Autonomous Agent Registry

## License

MIT — [ThoughtProof](https://thoughtproof.ai)
