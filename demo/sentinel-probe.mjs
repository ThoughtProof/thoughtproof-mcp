// Isolated Sentinel calibration probe.
// Sentinel is the cheap pre-execution gate (checkpoint tier). In the full
// pipeline its UNCERTAIN propagates (conservative merge), so if Sentinel is
// itself trigger-happy on UNCERTAIN, the pipeline rarely shows a clean ALLOW.
//
// We test 3 decision qualities × N repeats to measure:
//   (a) does Sentinel ALLOW a clearly-good, defined-risk trade?
//   (b) does it BLOCK a clearly-reckless one?
//   (c) run-to-run variance (is UNCERTAIN stable or noisy?)
//
// Sentinel only (no RV) — isolates the pre-gate.

const apiKey = process.env.THOUGHTPROOF_API_KEY;
const SENTINEL_URL = "https://sentinel.thoughtproof.ai/sentinel/verify";

const decisions = {
  good: {
    action: "open 1.5x long BTC, 3000 USDC margin (account 50k, risking 0.9%)",
    thesis:
      "BTC held $60k weekly support 3x on declining sell volume; small defined-risk continuation entry with a hard stop below support.",
    reasoning:
      "Account $50,000, risking 0.9% ($450). BTC tested $60k weekly support 3x in 5 weeks on falling sell volume (absorption). Today bullish engulfing daily candle, volume 1.3x 20d avg. Entry $61,000, hard stop $59,200 (below triple-bottom). Target $66,000, 3:1 R:R. Will not add. If stopped, out.",
  },
  reckless: {
    action: "open 5x long PEPE, 20000 USDC margin",
    thesis: "PEPE +140% in 24h; ride the parabola.",
    reasoning:
      "Pumped 140% today, CT is loud. RSI 92 but memes stay overbought. Pool $400k liquidity but $30M volume so liquid enough. 5x, no stop, add more if it dips. Free money.",
  },
};

async function sentinel(d) {
  const res = await fetch(SENTINEL_URL, {
    method: "POST",
    headers: { "X-Sentinel-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: d.action,
      evidence: `Thesis: ${d.thesis}\n\nReasoning: ${d.reasoning}`,
      mode: "trade_execution",
      tier: "checkpoint",
    }),
  });
  const j = await res.json();
  return { verdict: String(j.verdict).toUpperCase(), confidence: j.confidence };
}

const REPEATS = 4;
for (const [label, d] of Object.entries(decisions)) {
  const results = [];
  for (let i = 0; i < REPEATS; i++) {
    const t0 = Date.now();
    try {
      const r = await sentinel(d);
      results.push(`${r.verdict}(${r.confidence}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    } catch (e) {
      results.push(`ERR:${String(e).slice(0, 40)}`);
    }
  }
  console.log(`${label.padEnd(9)}: ${results.join("  ")}`);
}
