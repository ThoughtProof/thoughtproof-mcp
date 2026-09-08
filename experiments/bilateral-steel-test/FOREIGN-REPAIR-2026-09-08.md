# Foreign-agent objection repair — 2026-09-08T18:26Z

**Status:** n=2 (freeze 23 + 25). Seller B saw **no** buyer mandate and **no** human repair recipe.  
**Not H1. Not npm. Not ARR.**

| Case | Buyer1 | Seller B | Buyer2 | Terminal |
|---|---|---|---|---|
| 23 incoterm | BLOCK `dql_mtt03eq1_ntjtt2` | `proposal_changed` CPT→DDP dock-scan (own mandate allows both) | ALLOW `dql_mtt03r0t_59vv4d` `in_reply_to=o_…_intent` | **ALLOW** |
| 25 temp cert | BLOCK `dql_mtt03xmu_jqpmpb` | `escalate_human` — no temp cert in store, will not fabricate | (no resubmit) | **HUMAN** |

Pipeline: objection_received 2/2 · repair_attempted 1/2 · resubmitted 1/2 · ALLOW 1 · HUMAN 1 · BLOCK 0.

## Allowed meaning

- A **foreign** seller agent can consume a buyer structured objection and re-paper terms it is actually allowed to issue (23).
- Unresolved coverage with **no** issuable evidence stays non-executable and escalates instead of forging (25). That is the loop, not a failed demo.
- Human-written repair packets from the earlier slice are **not** what happened here.

## Limits

- n=2, one model (`grok-4-fast`), private-state notes are still harness-authored (honest capability, not a repair recipe)
- Buyer2 commit is a mechanical wrap of Seller B's new offer (buyer mandate stays on DQL; seller never saw it)
- Dual verifier instances / private ledgers still not built
- Do not promote ChatGPT's product sentence until more than 1 autonomous ALLOW

Raw: `runs/foreign-repair-2026-09-08T18-26-54Z.json`
