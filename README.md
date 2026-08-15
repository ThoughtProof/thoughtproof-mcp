# thoughtproof-mcp

[![npm version](https://img.shields.io/npm/v/thoughtproof-mcp.svg)](https://www.npmjs.com/package/thoughtproof-mcp)
[![CI](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ThoughtProof/thoughtproof-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [ThoughtProof](https://thoughtproof.ai) — pre-execution decision verification for AI agents.

**Hero tool:** `verify_decision`. It routes inside the tool to DQL (spend / checkout) or Sentinel (irreversible exit) and returns a fail-closed `execute` flag. `execute` is `true` only on a native `ALLOW`.

npm `latest` is still [`thoughtproof-mcp@0.3.0`](https://www.npmjs.com/package/thoughtproof-mcp) (verify-key path only). This branch is **0.3.1** and is **not published**. Do not use 0.3.0 as the `dqla_` path.

## Quick Start

This package is a **local stdio** MCP server (Node 18+) for Desktop / CLI hosts such as Cursor and Claude Desktop. It is not a publicly reachable remote MCP server. Remote MCP (including Grok Web/Mobile custom connectors) is out of scope and not shipped.

Desktop / CLI hosts can use the account token `dqla_…` shown **once** on checkout reveal. Hold that same token for `GET /dql/account` — the account route uses it; it does not issue a new one. You do **not** need to paste the raw verify key `dqlk_…`.

The `dqla_` path needs a DQL deploy that accepts `X-DQL-Account` on `POST /dql/verify`. Do not publish this MCP package until DQL #40 (credit-after-success) is fixed, merged, deployed, and live-tested.

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "npx",
      "args": ["-y", "thoughtproof-mcp"],
      "env": {
        "DQL_ACCOUNT_TOKEN": "dqla_your_account_token"
      }
    }
  }
}
```

`DQL_API_KEY` (alias `THOUGHTPROOF_DQL_KEY`) still works: set it to `dqlk_…` for the raw verify key, or to `dqla_…` for the same account-token path. If both a `dqlk_` key and a `dqla_` token are set, only the key is sent.

For the published verify-key release, `npx thoughtproof-mcp` / `npx thoughtproof-mcp@0.3.0`. The `dqla_` path is **0.3.1** on this branch (`npm run build`, then point the host at `dist/index.js`). Works with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, and other local stdio MCP clients.

## Tools

### `verify_decision` (hero)

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
| `DQL_ACCOUNT_TOKEN` | *(none)* | Account token (`dqla_…`) from checkout reveal (shown once). Hold it for `GET /dql/account`; that route uses the token, it does not mint one. No raw `dqlk_` paste. Sent as `X-DQL-Account` only. Requires DQL that accepts `X-DQL-Account` on `/dql/verify`. |
| `DQL_API_KEY` | *(none)* | DQL verify key (`dqlk_…`) or account token (`dqla_…`) for `verify_decision`. Alias: `THOUGHTPROOF_DQL_KEY`. A `dqlk_` value wins over `dqla_` so both are never sent. |
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

## Related

- [ThoughtProof](https://thoughtproof.ai) — Decision verification for AI agents
- [pot-cli](https://github.com/ThoughtProof/pot-cli) — CLI for reasoning verification
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Autonomous Agent Registry

## License

MIT — [ThoughtProof](https://thoughtproof.ai)
