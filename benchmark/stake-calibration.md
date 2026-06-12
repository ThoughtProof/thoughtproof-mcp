# Stake-Aware Verdict Calibration — Live Evidence

**What this shows:** ThoughtProof's `verify_trade` is not a block-everything filter.
The verdict threshold scales with the declared stake level, so the **same trade
decision** resolves differently depending on how much capital is at risk.

## The probe

A single, internally-consistent, defined-risk trade was submitted to the live
RV engine (`api.thoughtproof.ai/v1/check`, `speed=standard`, 3-model adversarial
panel) at every stake level. Only `stakeLevel` changed between runs.

> Trade: `open 1.5x long BTC, 3000 USDC margin` · account $50k · risking ~0.9%
> · BTC held $60k weekly support 3x on declining sell volume · hard stop $59,200
> · ~3:1 R:R · "will not add to the position."

## Result (live, 2026-06-12)

| stakeLevel | threshold | verdict | confidence | objections |
|------------|-----------|---------|------------|------------|
| micro | 0.40 | **ALLOW** | 0.82 | 1 |
| low | 0.50 | **ALLOW** | 0.92 | 0 |
| medium | 0.60 | **ALLOW** | 0.72 | 2 |
| high | 0.75 | **BLOCK** | 0.80 | 3 |
| critical | 0.85 | **UNCERTAIN** | 0.62 | 3 |

3 models, `mdi ≈ 0.86` throughout (genuine measured dissent, not degraded).

## Why this matters

- A routine / small position (`micro`–`medium`) with sound reasoning **executes**.
- The **identical** decision at high or critical stake — where a flaw is expensive —
  is held back for review or blocked, with the objections surfaced so the agent
  can revise.
- This is the difference between a verification *layer* and a kill switch. The
  agent keeps trading; the gate gets stricter exactly where the downside grows.

## Methodology note

`confidence` on a BLOCK is verdict-certainty (how sure the engine is in the
block), derived from objection strength — not a soundness score. Soundness drives
the internal threshold comparison; the public confidence is mapped for honesty
(never 1.0/0.0). Raw soundness is retained server-side for calibration.
