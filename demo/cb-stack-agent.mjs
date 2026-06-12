// Demo: a Coinbase-stack user's trading agent that verifies every decision
// through ThoughtProof's MCP `verify_trade` tool BEFORE executing.
//
// POV: you are a CB-stack user. Your agent (Claude/GPT/whatever) decides what
// to trade. Before it touches the Coinbase execution layer (CB4A), it calls
// verify_trade. ALLOW → execute. BLOCK/UNCERTAIN → it reads the objections,
// revises, and re-verifies — or stands down. Payment is per-call via x402
// (here we use an API key; in production CB agents pay per call).
//
// This runs LIVE against the real Sentinel + RV backends. Not a mockup.
//
// Run: node --env-file=../verified-trading-agent/.env demo/cb-stack-agent.mjs

import { verifyTrade } from "../dist/verify-client.js";

const apiKey = process.env.THOUGHTPROOF_API_KEY;
if (!apiKey) {
  console.error("THOUGHTPROOF_API_KEY not set — run with --env-file=../verified-trading-agent/.env");
  process.exit(1);
}

// ── Simulated CB4A execution layer ─────────────────────────────────────────
// In production this is the Coinbase agent execution call. Here it's a stub
// that just records what WOULD have hit the exchange.
const executed = [];
function cb4aExecute(decision) {
  executed.push(decision.action);
  console.log(`   🟢 CB4A EXECUTED: ${decision.action}`);
}

// ── The verify-before-execute gate ─────────────────────────────────────────
async function decideAndAct(decision, label) {
  console.log(`\n┌─ ${label}`);
  console.log(`│  Agent proposes: ${decision.action}`);
  console.log(`│  Thesis: ${decision.thesis}`);
  console.log(`│  → calling verify_trade (MCP) before execution…`);

  const v = await verifyTrade(decision, { apiKey, sentinelTier: "checkpoint" });

  console.log(`│  ← ${v.verdict} (${v.route}, ${(v.latencyMs / 1000).toFixed(1)}s)`);
  if (v.rv?.modelCount) console.log(`│    RV: ${v.rv.modelCount}-model adversarial panel, conf ${v.rv.confidence}`);
  if (v.attestation.rvSigner) console.log(`│    on-chain signer: ${v.attestation.rvSigner}`);

  if (v.verdict === "ALLOW") {
    console.log(`│  Verdict ALLOW → executing.`);
    cb4aExecute(decision);
    return { acted: true, verdict: v.verdict };
  }

  // BLOCK or UNCERTAIN → the agent gets structured objections back.
  console.log(`│  Verdict ${v.verdict} → NOT executing. Objections returned to agent:`);
  v.objections.forEach((o, i) => console.log(`│    ${i + 1}. [${o.severity}] ${o.explanation.replace(/\*\*/g, "").slice(0, 140)}…`));
  console.log(`│  Agent reasons over objections → stands down (capital preserved).`);
  console.log(`└─ no trade. ✅ avoided.`);
  return { acted: false, verdict: v.verdict, objections: v.objections.length };
}

// ── Three examples a CB-stack agent might propose ──────────────────────────
const examples = [
  {
    label: "Example 1 — Reckless leverage chase (high stake)",
    decision: {
      action: "open 5x long PEPE, 20000 USDC margin",
      thesis: "PEPE +140% in 24h on huge volume; ride the parabola.",
      reasoning:
        "Pumped 140% today, CT is loud. RSI 92 but memes stay overbought for days. Pool liquidity only $400k but $30M volume so liquid enough. 5x, no stop, I'll add more if it dips. Free money.",
      situation:
        "PEPE/WETH pool. +140% 24h. RSI14 92. Liquidity $400k, volume $30M, age 18 days. Vertical candle, no consolidation.",
      stakeLevel: "high",
    },
  },
  {
    label: "Example 2 — Disciplined, defined-risk entry (low stake: 0.9% of account, hard stop)",
    decision: {
      action: "open 1.5x long BTC, 3000 USDC margin (account 50k, risking 0.9%)",
      thesis:
        "BTC held the $60k weekly support for the third time on declining sell volume; small defined-risk continuation entry with a hard stop below support.",
      reasoning:
        "Account $50,000. Risking ~0.9%. BTC tested $60k weekly support 3x in 5 weeks on falling sell volume (absorption). Today bullish engulfing daily candle, volume 1.3x 20d avg. Entry $61,000, hard stop $59,200 (below triple-bottom + round-number buffer). Target range high $66,000 (~3:1 R:R). Will not add to the position. If stopped, out.",
      situation:
        "BTCUSDT. Price $61,000. $60k weekly support tested 3x in 5 weeks on declining sell volume. Today bullish engulfing candle, volume 1.3x 20d avg. RSI14 52. Range $60k-$66k.",
      // risk-based stake mapping: 0.9% of account, hard stop, no adds -> low stake
      stakeLevel: "low",
    },
  },
  {
    label: "Example 3 — Plausible but flawed mean-reversion short (high stake)",
    decision: {
      action: "open 3x short SOL, 8000 USDC margin",
      thesis: "SOL is overbought at RSI 78 after a 5-day run; fade the extension back to the mean.",
      reasoning:
        "SOL has run 5 green days and RSI is 78. Overbought means it's due for a pullback, so I'll short 3x to catch the mean reversion. The 5-day rally can't continue forever. I don't have a specific invalidation level but I'll watch it. Shorting strength is how you sell the top.",
      situation:
        "SOLUSDT. +38% over 5 days, RSI14 78, price at new 60-day high on strong volume, no distribution signs.",
      stakeLevel: "high",
    },
  },
];

console.log("════════════════════════════════════════════════════════════");
console.log(" CB-STACK AGENT + ThoughtProof verify_trade (LIVE)");
console.log(" Every proposed trade is verified before it reaches CB4A.");
console.log("════════════════════════════════════════════════════════════");

const results = [];
for (const ex of examples) {
  results.push(await decideAndAct(ex.decision, ex.label));
}

console.log("\n════════════════════════════════════════════════════════════");
console.log(" SUMMARY");
const acted = results.filter((r) => r.acted).length;
console.log(` Proposed: ${results.length} | Executed: ${acted} | Gated: ${results.length - acted}`);
results.forEach((r, i) => console.log(`  ${i + 1}. ${examples[i].label.split("—")[1].trim()} → ${r.verdict}${r.acted ? " (executed)" : " (stood down)"}`));
console.log(` Actions that reached CB4A: ${executed.length ? executed.join("; ") : "none"}`);
console.log("════════════════════════════════════════════════════════════");
