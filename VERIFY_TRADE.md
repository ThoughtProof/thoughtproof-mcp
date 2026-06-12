# ThoughtProof MCP — `verify_trade`

A Model Context Protocol server that lets **any** MCP-capable agent verify a
decision **before** it executes. Built for the Coinbase agent stack: an agent
proposes a trade, calls `verify_trade`, and gets back `ALLOW` / `BLOCK` /
`UNCERTAIN` plus structured objections. Paid per call via x402.

## Why

Autonomous agents that move real capital need a reliability layer. `verify_trade`
routes a decision through:

1. **Sentinel** — a cheap pre-execution gate (~3.5s).
2. **RV** — an adversarial multi-model reasoning panel (powered by SERV Reasoning),
   for high-stakes calls that survive Sentinel.

Verdicts are conservative (`BLOCK > UNCERTAIN > ALLOW`). `UNCERTAIN` is
fail-closed: the agent must not execute, but receives objections it can reason
over and revise. This is the loop that makes autonomous execution trustworthy —
not a binary filter, a verification layer.

## Tools

| Tool | Purpose |
|------|---------|
| `verify_trade` | Pre-execution gate for trading/action agents. Sentinel → RV. Returns verdict + objections + on-chain attestation. |
| `verify_claim` | Verify any claim or AI reasoning (RV adversarial consensus). |
| `check_agent_score` | Look up an agent's trust score. |

## Install

```bash
npm install
npm run build
```

## Run

```bash
# stdio (standard MCP transport — the CB stack connects the same way)
THOUGHTPROOF_API_KEY=*** npm start
```

### Connect from Claude / any MCP client

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "node",
      "args": ["/path/to/thoughtproof-mcp/dist/index.js"],
      "env": { "THOUGHTPROOF_API_KEY": "tp_op_..." }
    }
  }
}
```

## Payment (x402)

If `THOUGHTPROOF_API_KEY` is set, calls authenticate by key (Flow A). Otherwise
the server forwards an x402 payment signature on the Sentinel call and surfaces
the settlement receipt. Two payment networks are supported by the backend:

- **Base mainnet** (`eip155:8453`) via the Circle x402 facilitator
- **GOAT Network** (`eip155:2345`) via the GOAT x402 gateway

```bash
# paid-per-call, no API key
THOUGHTPROOF_X402_PAYSIG=<base64 payment payload> npm start
```

## `verify_trade` input

```ts
{
  action: string;     // "open 5x long BTC, 8000 USDC margin"
  thesis: string;     // one-line rationale
  reasoning: string;  // the full chain of thought — this is what gets verified
  situation?: string; // optional market snapshot WITHOUT the action (stronger verification)
  stake?: "routine" | "high"; // "high" (default) → full Sentinel→RV pipeline
}
```

## Demos (run live against the real backends)

```bash
# MCP wiring smoke test (no network)
node demo/smoke.mjs

# single live verify_trade call
node --env-file=../verified-trading-agent/.env demo/live-test.mjs

# CB-stack agent: 3 proposed trades, verify-before-execute, self-correction
node --env-file=../verified-trading-agent/.env demo/cb-stack-agent.mjs
```

## Benchmark

`benchmark/benchmark.md` is generated from the live verified-trading-agent
decision log (`scripts/build-benchmark.mjs`). It reports the agent's behavior
with the verification layer in place — including a fully transparent split
between early-calibration cycles and the calibrated showcase.
