// Calibration probe: can the pipeline ALLOW an airtight, conservative trade?
// If even this blocks, the RV panel is mis-calibrated for a "trading improvement"
// benchmark and that's a blocker to surface before the CB demo.

import { verifyTrade } from "../dist/verify-client.js";

const apiKey = process.env.THOUGHTPROOF_API_KEY;

const airtight = {
  action: "open 1.5x long BTC, 3000 USDC margin (account: 50000 USDC, risking 0.9%)",
  thesis:
    "BTC held the $60k weekly support for the third time on declining sell volume; entering small with a hard stop below support for a defined-risk continuation toward the range high.",
  reasoning:
    "Account size is $50,000 USDC. I am risking 0.9% ($450) on this trade. Setup: BTC has tested the $60,000 weekly support three times over five weeks, each test on progressively lower sell volume — a textbook absorption pattern. Today price bounced from $60,200 with a bullish engulfing daily candle on volume 1.3x the 20-day average. Entry: $61,000. Hard stop: $59,700 (below the triple-bottom support and the recent swing low), which caps loss at $450 = 0.9% of the account. That is the 1.5x position on $3,000 margin: notional $4,500, a $1,300 adverse move to stop = ~$450 loss after leverage, fully pre-defined. Target: the range high at $66,000, a 4:1 reward-to-risk. Why now: the third support test with falling sell volume and a confirmed reversal candle is the highest-probability moment, and the defined stop means I am wrong fast and cheap if support breaks. Main counter-argument: a fourth test often breaks support, and a macro risk-off event could gap price through my stop — which is exactly why size is small (1.5x, not 5x) and risk is capped under 1% so a stop-jump is survivable. I will not add to the position under any circumstance; if stopped, I am out.",
  situation:
    "BTCUSDT. Price $61,000. $60k weekly support tested 3x in 5 weeks on declining sell volume. Today: bullish engulfing daily candle, volume 1.3x 20d avg. RSI14 52 (neutral). Range $60k-$66k.",
  stakeLevel: "high",
};

console.log("Probing pipeline with an airtight, sub-1%-risk, defined-stop trade…\n");
const r = await verifyTrade(airtight, { apiKey, sentinelTier: "checkpoint" });
console.log(`VERDICT: ${r.verdict} (${r.route}, ${(r.latencyMs / 1000).toFixed(1)}s)`);
if (r.sentinel) console.log(`Sentinel: ${r.sentinel.verdict} (conf ${r.sentinel.confidence})`);
if (r.rv) console.log(`RV: ${r.rv.verdict} (conf ${r.rv.confidence}, ${r.rv.modelCount} models)`);
if (r.objections.length) {
  console.log(`Objections:`);
  r.objections.forEach((o, i) => console.log(`  ${i + 1}. [${o.severity}] ${o.explanation.replace(/\*\*/g, "")}`));
} else {
  console.log("No objections.");
}
