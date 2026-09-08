# Bilateral steel-test — protocol slice (unpublished)

**Not** the live LLM experiment. **Not** npm. Design freeze (workspace): `DRAFTS/2026-09-08-BILATERAL-STEEL-TEST-v0.1.md`

## What is implemented

1. MCP envelope on `0.4.0-dev`: `structured_objections`, `loop`, `in_reply_to`.
2. Host-contract tests in `test/repair-loop-host.test.js` (mocked DQL).
3. **Live protocol slice** `live-protocol-slice.mjs` — 2026-09-08 run **4/4 PASS** (see `LIVE-PROTOCOL-2026-09-08.md`). GMX `dqlk_`. Comparison A only.
4. **Comparison B detector slice** `comp-b-critic.py` — 2026-09-08: critic `grok-4-fast` **7/7 = rules 7/7 = DQL execute flags**. **No detector lift.** DET-heavy. See `COMP-B-2026-09-08.md`.

## What is not implemented

- Full Comparison B / 25-case bed / non-DET Cases 23–25 load that could reject H0
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
