// Live end-to-end test of verify_trade against the real ThoughtProof backends.
// Uses THOUGHTPROOF_API_KEY (Flow A). Calls the actual verifyTrade() the MCP
// tool wraps — proves the pipeline returns a real verdict + objections.
//
// Run: node --env-file=../verified-trading-agent/.env demo/live-test.mjs
//      (or with THOUGHTPROOF_API_KEY exported)

import { verifyTrade } from "../dist/verify-client.js";

const apiKey = process.env.THOUGHTPROOF_API_KEY;
if (!apiKey) {
  console.error("THOUGHTPROOF_API_KEY not set");
  process.exit(1);
}

const cases = [
  {
    label: "Reckless chase (should be flagged)",
    input: {
      action: "open 5x long PEPE, 20000 USDC margin",
      thesis:
        "PEPE is up 140% in 24h on huge volume; momentum is undeniable and I want to ride the parabola before it goes higher.",
      reasoning:
        "The token has pumped 140% today. Everyone on CT is talking about it. RSI is 92 but in a strong meme rally RSI stays overbought for days. The pool only has $400k liquidity but volume is $30M so it's clearly liquid enough. I'll use 5x because conviction is high. No real stop — I'll just watch it. If it dips I'll add more. This is free money, the trend is my friend.",
      situation:
        "PEPE/WETH on-chain pool. Price +140% 24h. RSI14 92 (extreme overbought). Liquidity $400k, 24h volume $30M, pool age 18 days. Vertical candle structure, no consolidation.",
      stakeLevel: "high",
    },
  },
];

for (const c of cases) {
  console.log(`\n=== ${c.label} ===`);
  const t0 = Date.now();
  try {
    const r = await verifyTrade(c.input, { apiKey, sentinelTier: "checkpoint" });
    console.log(`VERDICT: ${r.verdict}  (route: ${r.route}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`Recommendation: ${r.recommendation}`);
    if (r.sentinel) {
      console.log(`Sentinel: ${r.sentinel.verdict} (conf ${r.sentinel.confidence})`);
      if (r.sentinel.attestation?.claimHash)
        console.log(`  claimHash: ${r.sentinel.attestation.claimHash}`);
    }
    if (r.rv) {
      console.log(`RV: ${r.rv.verdict} (conf ${r.rv.confidence}, ${r.rv.modelCount ?? "?"} models, profile ${r.rv.profile ?? "?"})`);
      if (r.rv.attestation?.signature)
        console.log(`  rv signature: ${r.rv.attestation.signature.slice(0, 30)}…  signer: ${r.rv.attestation.signer ?? "?"}`);
    }
    if (r.objections.length) {
      console.log(`Objections (${r.objections.length}):`);
      r.objections.forEach((o, i) => console.log(`  ${i + 1}. [${o.severity}] ${o.explanation}`));
    }
    console.log(`Payment: ${r.payment?.method}`);
  } catch (err) {
    console.error(`ERROR: ${String(err)}`);
    process.exitCode = 1;
  }
}
