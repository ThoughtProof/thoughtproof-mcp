// Variance probe: same borderline-good trade, stakeLevel=medium, N runs.
// Hypothesis: critic materiality labels flip run-to-run (material <-> notable),
// swinging soundness across the 0.42/0.60 thresholds -> verdict lottery.
//
// Public API doesn't expose materiality counts, but confidence is derived:
//   soundness = 1 - 0.30*material - 0.10*notable - 0.02*minor  (ALLOW/UNCERTAIN)
//   BLOCK conf = 0.5 + 0.15*material + 0.05*notable (clamped .5-.95)
// So we can infer the label mix from (verdict, confidence).

const apiKey = process.env.THOUGHTPROOF_API_KEY;
const RV_URL = "https://api.thoughtproof.ai/v1/check";

const body = {
  claim:
    "open 1.5x long BTC, 3000 USDC margin. Thesis: BTC held the $60k weekly support for the third time on declining sell volume; small defined-risk continuation entry with a hard stop below support.",
  context:
    "Account $50,000. Risking ~0.9%. Setup: BTC tested $60k weekly support 3x in 5 weeks on falling sell volume (absorption). Today bullish engulfing daily candle, volume 1.3x 20d avg. Entry $61,000, hard stop $59,200 (below triple-bottom + round-number buffer). Target range high $66,000 (~3:1 R:R). Will not add to the position. If stopped, out.",
  situation:
    "BTCUSDT. Price $61,000. $60k weekly support tested 3x in 5 weeks on declining sell volume. Today: bullish engulfing daily candle, volume 1.3x 20d avg. RSI14 52 (neutral). Range $60k-$66k.",
  stakeLevel: "medium",
  speed: "standard",
};

function inferLabels(verdict, conf) {
  // Best-effort inversion of the confidence formulas.
  if (verdict === "BLOCK") {
    // conf = 0.5 + 0.15m + 0.05n
    for (let m = 0; m <= 5; m++)
      for (let n = 0; n <= 5; n++)
        if (Math.abs(0.5 + 0.15 * m + 0.05 * n - conf) < 0.011)
          return `~${m} material, ${n} notable (from BLOCK certainty)`;
    return "(unresolved)";
  }
  // soundness = 1 - 0.3m - 0.1n - 0.02k
  for (let m = 0; m <= 3; m++)
    for (let n = 0; n <= 5; n++)
      for (let k = 0; k <= 4; k++)
        if (Math.abs(1 - 0.3 * m - 0.1 * n - 0.02 * k - conf) < 0.011)
          return `~${m} material, ${n} notable, ${k} minor (from soundness)`;
  return "(unresolved)";
}

const N = 5;
const out = [];
for (let i = 1; i <= N; i++) {
  const t0 = Date.now();
  try {
    const res = await fetch(RV_URL, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    const line = `run ${i}: ${String(d.verdict).padEnd(9)} conf=${d.confidence}  objs=${(d.objections ?? []).length}  mdi=${d.mdi}  ${((Date.now() - t0) / 1000).toFixed(0)}s  → ${inferLabels(d.verdict, d.confidence)}`;
    console.log(line);
    out.push({ verdict: d.verdict, conf: d.confidence });
  } catch (e) {
    console.log(`run ${i}: ERROR ${String(e).slice(0, 60)}`);
  }
}
const counts = out.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
console.log(`\nVerdict distribution over ${out.length} runs:`, JSON.stringify(counts));
