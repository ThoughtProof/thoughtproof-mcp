# Bilateral steel-test — protocol slice (unpublished)

**Not** the live LLM experiment. **Not** npm. Design freeze (workspace): `DRAFTS/2026-09-08-BILATERAL-STEEL-TEST-v0.1.md`

## What is implemented

1. MCP envelope on `0.4.0-dev`: `structured_objections`, `loop`, `in_reply_to`.
2. Host-contract tests in `test/repair-loop-host.test.js` (mocked DQL).
3. **Live protocol slice** `live-protocol-slice.mjs` — 2026-09-08 run **4/4 PASS** (see `LIVE-PROTOCOL-2026-09-08.md`). GMX `dqlk_`. Comparison A only.
4. **Comparison B detector slice** `comp-b-critic.py` — DET-heavy 7/7, no detector lift. `COMP-B-2026-09-08.md`.
5. **Non-DET 23–25** `nendet-2325.py` — Seller ALLOW / Buyer BLOCK / repair ALLOW. Critic also refused. Case24 = DET. `NENDET-2325-2026-09-08.md`.
6. **Actor vs gate** `actor-vs-gate.py` — motivated first pass would close; DQL BLOCK. `ACTOR-VS-GATE-2026-09-08.md`.
7. **Foreign repair** `foreign-repair-2325.py` — our Grok Seller B; 23 ALLOW / 25 HUMAN. `FOREIGN-REPAIR-2026-09-08.md`.
8. **CAMEL blind** `camel-blind.py` — camel-ai 0.2.90, anti-cheat freeze. 23/25 structured PASS; both critic-prose FAIL. `CAMEL-BLIND-2026-09-08.md`.

## What is not implemented

- Full 25-case bed / dual verifier instances / private ledgers
- Detector lift vs a critic that *misses* 23/25 (this grok-4-fast did not miss)
- Dual real DQL/Sentinel instances / private ledgers for full bilateral bed
- All 25 fixtures as live HTTP
- npm publish / Grok pin change (`@0.3.2` unchanged)

## Run

```bash
# unit
npm run build && npm test

# live protocol slice (uses KEY_FILE → dqlk_)
KEY_FILE=$HOME/.hermes/.credentials/dql-api-key-gmx \
  node experiments/bilateral-steel-test/live-protocol-slice.mjs
```

## Host contract (any agent, including Hermes/Grok on this dist)

1. If `execute !== true` → do not do the consequential action.
2. If `structured_objections[].severity === "blocked_until"` → repair via `repair_hints`, call `verify_decision` again with `in_reply_to=<objection_id>`.
3. New call = new `receipt_id`. Prior ALLOW does not carry.
