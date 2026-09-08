/**
 * Protocol harness for structured-objection repair (unpublished MCP).
 * Not a live LLM steel-test. Comparison B detector quality is NOT measured here.
 * Host rule: never execute unless execute===true; repair = new verify with in_reply_to.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapDqlEnvelope,
  verifyDecision,
} from "../dist/verify-decision.js";

const FIX_DQLK = "dql" + "k_" + "test";

function dqlBody({ id, verdict, axes, rationale }) {
  return {
    id,
    version: "0.2.0",
    axes,
    aggregate: { verdict, rationale },
  };
}

const BLOCK_SCOPE = dqlBody({
  id: "dql_loop_1",
  verdict: "BLOCK",
  rationale: "Scope axis failed.",
  axes: [
    { axis: "intent", verdict: "PASS", objection: "" },
    { axis: "scope", verdict: "FAIL", objection: "SKU not on allowlist." },
  ],
});

const ALLOW_ALL = dqlBody({
  id: "dql_loop_2",
  verdict: "ALLOW",
  rationale: "All axes passed.",
  axes: [
    { axis: "intent", verdict: "PASS", objection: "" },
    { axis: "scope", verdict: "PASS", objection: "" },
  ],
});

const BLOCK_BUDGET = dqlBody({
  id: "dql_loop_3",
  verdict: "BLOCK",
  rationale: "Total exceeds remaining budget.",
  axes: [
    { axis: "intent", verdict: "PASS", objection: "" },
    { axis: "risk", verdict: "FAIL", objection: "Commit 800 exceeds remaining 400." },
  ],
});

const BUYER_INCOTERM_BLOCK = dqlBody({
  id: "dql_buyer_23",
  verdict: "BLOCK",
  rationale: "Delivery class not covered.",
  axes: [
    { axis: "intent", verdict: "PASS", objection: "" },
    {
      axis: "scope",
      verdict: "FAIL",
      objection: "SLA is CPT (risk on first carrier); mandate requires DDP-equivalent dock scan.",
    },
  ],
});

const SELLER_ALLOW = dqlBody({
  id: "dql_seller_23",
  verdict: "ALLOW",
  rationale: "Seller mandate covered.",
  axes: [{ axis: "intent", verdict: "PASS", objection: "" }],
});

async function hostLoop({ firstBody, secondBody, expectSecond }) {
  const calls = [];
  const first = await verifyDecision(
    {
      mandate: "Acquire widgets under mandate",
      proposed_action: "COMMIT_PO",
      reasoning: "Seller quote looks fine",
      mode: "dql",
    },
    {
      dqlApiKey: FIX_DQLK,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(firstBody), { status: 200 });
      },
    },
  );
  if (first.execute) {
    return { first, second: null, calls, executed: true };
  }
  const oid = first.structured_objections[0]?.objection_id;
  assert.ok(oid, "blocked envelope must carry structured objection_id");
  if (!expectSecond) {
    return { first, second: null, calls, executed: false };
  }
  const second = await verifyDecision(
    {
      mandate: "Acquire widgets under mandate",
      proposed_action: "COMMIT_PO revised",
      reasoning: "Repair packet",
      mode: "dql",
      in_reply_to: oid,
    },
    {
      dqlApiKey: FIX_DQLK,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(secondBody), { status: 200 });
      },
    },
  );
  return { first, second, calls, executed: second.execute === true };
}

describe("host repair loop (protocol, mocked DQL)", () => {
  it("case 17: revise claim → ALLOW on second receipt; first ALLOW does not carry", async () => {
    const { first, second, calls, executed } = await hostLoop({
      firstBody: BLOCK_SCOPE,
      secondBody: ALLOW_ALL,
      expectSecond: true,
    });
    assert.equal(first.execute, false);
    assert.equal(first.loop, "challenged");
    assert.equal(first.structured_objections[0].severity, "blocked_until");
    assert.equal(second.execute, true);
    assert.equal(second.loop, "covered");
    assert.equal(second.in_reply_to, first.structured_objections[0].objection_id);
    assert.notEqual(second.receipt_id, first.receipt_id);
    assert.match(calls[1].context, /in_reply_to=/);
    assert.equal(executed, true);
  });

  it("case 18: repair that introduces budget fail stays execute:false", async () => {
    const { first, second, executed } = await hostLoop({
      firstBody: BLOCK_SCOPE,
      secondBody: BLOCK_BUDGET,
      expectSecond: true,
    });
    assert.equal(first.execute, false);
    assert.equal(second.execute, false);
    assert.equal(second.loop, "repairing");
    assert.ok(second.structured_objections.some((o) => o.code === "RISK"));
    assert.equal(executed, false);
  });

  it("case 20: ordinary ALLOW has empty structured_objections and loop covered", () => {
    const env = mapDqlEnvelope(ALLOW_ALL);
    assert.equal(env.execute, true);
    assert.equal(env.loop, "covered");
    assert.deepEqual(env.structured_objections, []);
  });

  it("case 23: Seller ALLOW + Buyer HALT — one side does not authorize the other", () => {
    const seller = mapDqlEnvelope(SELLER_ALLOW);
    const buyer = mapDqlEnvelope(BUYER_INCOTERM_BLOCK);
    assert.equal(seller.execute, true);
    assert.equal(buyer.execute, false);
    assert.equal(buyer.structured_objections[0].severity, "blocked_until");
    assert.equal(seller.execute && buyer.execute, false);
  });

  it("host must not execute on challenged even if critic would waffle", async () => {
    const { first, executed } = await hostLoop({
      firstBody: BLOCK_SCOPE,
      expectSecond: false,
    });
    assert.equal(first.execute, false);
    assert.equal(executed, false);
  });
});
