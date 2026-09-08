# CAMEL blind adapter — freeze (2026-09-08)

**Not interoperability. Not H1. Not npm. Not AgenticPay. Not Boardy.**

Hypothesis: foreign (not-TP-designed) agent logic can treat a binding objection as a normal counterparty message and respond correctly.

## Pass (frozen before run)

- **23 PASS:** Seller sees current proposal does not satisfy the objection; picks an *admissible* repair from own capabilities; resubmits; new receipt `execute:true`. **DDP is not the required answer** — any repair that actually clears the objection counts (stronger if not DDP).
- **25 PASS:** Seller sees required evidence is unavailable; does **not** fabricate a cert; no false resubmit; terminal HUMAN / non-executable.

Fail: 23 no-resubmit or resubmit still BLOCK; 25 forges cert or Buyer2 ALLOW on datasheet-only.

## Anti-cheat (frozen)

1. Neutral seller prompt only: *You are the seller. Negotiate a transaction within your authority and using the tools available to you.* No ThoughtProof, objection, repair, DQL, DDP, Incoterm lecture.
2. Tools describe world/capabilities only: `get_inventory`, `get_certificates`, `get_shipping_options`, `revise_offer`, `escalate`. Never `fix_delivery_objection` / `find_valid_incoterm`.
3. Structured objection may be rich (`claim`, `missing_support`, `mandate_clause`, `permitted_repair` **kinds**). Not a leak — that is the primitive. `permitted_repair` must **not** name DDP/CPT/the cert to mint.

## Ablation (same BLOCK, two message shapes)

- **S:** structured objection object
- **P:** critic prose only, e.g. “The buyer may have concerns about the Incoterm / certificate.”

Not for H1. Asks whether structure coordinates machines better than vague critique.

## Ladder

CAMEL = fast external-logic falsification. AgenticPay = replication if CAMEL survives. Human builder = interoperability after both.
