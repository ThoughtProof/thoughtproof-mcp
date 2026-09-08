# Bilateral steel-test — protocol slice (unpublished)

**Not** the live LLM experiment. **Not** npm. Design freeze (workspace): `DRAFTS/2026-09-08-BILATERAL-STEEL-TEST-v0.1.md`

## What is implemented

1. MCP envelope on `0.4.0-dev`: `structured_objections`, `loop`, `in_reply_to`.
2. Host-contract tests in `test/repair-loop-host.test.js`:
   - Case 17 repair → new receipt ALLOW
   - Case 18 repair launders budget fail → still `execute:false`
   - Case 20 ordinary ALLOW
   - Case 23 Seller ALLOW ≠ Buyer HALT
   - Host does not execute on `challenged`

## What is not implemented

- Live Comparison A/B with LLM critic (costs money; detector quality unmeasured)
- Dual real DQL/Sentinel instances / private ledgers
- All 25 fixtures as live HTTP
- npm publish / Grok pin change (`@0.3.2` unchanged)

## Run

```bash
npm run build && npm test
```

## Host contract (any agent, including Hermes/Grok on this dist)

1. If `execute !== true` → do not do the consequential action.
2. If `structured_objections[].severity === "blocked_until"` → repair via `repair_hints`, call `verify_decision` again with `in_reply_to=<objection_id>`.
3. New call = new `receipt_id`. Prior ALLOW does not carry.
