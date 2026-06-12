// Does the public /v1/check verdict respond to stakeLevel? Same airtight-ish
// trade across stake levels. If low/micro → ALLOW and high/critical → BLOCK,
// the gate is stake-aware (a feature), not a blunt block-everything filter.
//
// This calls /v1/check directly (not the pipeline) so we isolate the RV verdict
// logic and the stakeLevel threshold.

const apiKey = process.env.THOUGHTPROOF_API_KEY;
const RV_URL = "https://api.thoughtproof.ai/v1/check";

const claim =
  "open 1.5x long BTC, 3000 USDC margin. Thesis: BTC held the $60k weekly support for the third time on declining sell volume; small defined-risk continuation entry with a hard stop below support.";
const context =
  "Account $50,000. Risking ~0.9%. Setup: BTC tested $60k weekly support 3x in 5 weeks on falling sell volume (absorption). Today bullish engulfing daily candle, volume 1.3x 20d avg. Entry $61,000, hard stop $59,200 (below triple-bottom + round-number buffer). Target range high $66,000 (~3:1 R:R). Will not add to the position. If stopped, out.";
const situation =
  "BTCUSDT. Price $61,000. $60k weekly support tested 3x in 5 weeks on declining sell volume. Today: bullish engulfing daily candle, volume 1.3x 20d avg. RSI14 52 (neutral). Range $60k-$66k.";

const levels = ["micro", "low", "medium", "high", "critical"];

for (const stakeLevel of levels) {
  const t0 = Date.now();
  try {
    const res = await fetch(RV_URL, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ claim, context, situation, stakeLevel, speed: "standard" }),
    });
    const d = await res.json();
    const objs = Array.isArray(d.objections) ? d.objections.length : 0;
    console.log(
      `stake=${stakeLevel.padEnd(8)} → ${String(d.verdict).padEnd(9)} conf=${d.confidence} ` +
        `objections=${objs} models=${d.modelCount} mdi=${d.mdi} (${((Date.now() - t0) / 1000).toFixed(0)}s)` +
        (d.degraded ? " ⚠️DEGRADED" : "")
    );
  } catch (err) {
    console.log(`stake=${stakeLevel} → ERROR ${String(err)}`);
  }
}
