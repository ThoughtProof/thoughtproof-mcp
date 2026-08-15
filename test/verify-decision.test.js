import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeDecision } from "../dist/route-decision.js";
import {
  buildDqlAuthHeaders,
  callDql,
  resolveDqlCredential,
} from "../dist/dql-client.js";
import {
  executeAllowed,
  mapDqlEnvelope,
  mapSentinelEnvelope,
  verifyDecision,
} from "../dist/verify-decision.js";

const DQL_FIXTURE = {
  id: "dql_abc123_x7k9p2",
  version: "0.2.0",
  axes: [
    {
      axis: "intent",
      verdict: "PASS",
      confidence: 0.9,
      reasoning: "Action matches the stated goal.",
      objection: "",
    },
    {
      axis: "scope",
      verdict: "FAIL",
      confidence: 0.82,
      reasoning: "Destination does not match the mandate.",
      objection: "Flight arrives in Munich, not Rome.",
    },
  ],
  aggregate: {
    verdict: "BLOCK",
    confidence: 0.82,
    triggered_by: ["scope"],
    rationale: "Scope axis failed.",
  },
  meta: {
    duration_ms: 1200,
    models_used: ["serv:serv-nano"],
    axes_evaluated: ["intent", "scope"],
    sandbox: false,
  },
};

const SENTINEL_FIXTURE = {
  id: "req_m1abc_x9f2kq",
  verdict: "UNCERTAIN",
  confidence: 0.4,
  reasoning: "Insufficient evidence for a production deploy.",
  objections: [
    {
      step_id: "step_0",
      criterion: "evidence",
      score: 0.2,
      predicate: "unsupported",
      quote: null,
      reasoning: "No test results cited.",
    },
  ],
  mode: "action_authorization",
  tier: "checkpoint",
  meta: { duration_ms: 800, models_used: ["serv-nano"] },
};

describe("routeDecision heuristic", () => {
  it("routes spend/checkout language to dql", () => {
    assert.equal(
      routeDecision({
        mandate: "Buy the cheapest flight under my budget",
        proposed_action: "Purchase LH1234 for $180",
        reasoning: "Price is within the spend cap",
      }),
      "dql"
    );
    assert.equal(
      routeDecision({
        mandate: "Complete browser checkout",
        proposed_action: "Click pay on the Stripe cart",
        reasoning: "Ready to submit payment",
      }),
      "dql"
    );
  });

  it("routes high-blast irreversible exits without spend language to sentinel", () => {
    assert.equal(
      routeDecision({
        mandate: "Ship the release",
        proposed_action: "Deploy the API to production",
        reasoning: "CI is green; send-to-prod now",
      }),
      "sentinel"
    );
    assert.equal(
      routeDecision({
        mandate: "Clean up stale notes",
        proposed_action: "Delete the user memory write from last week",
        reasoning: "The entry is obsolete",
      }),
      "sentinel"
    );
    assert.equal(
      routeDecision({
        mandate: "Announce the change",
        proposed_action: "Publish the changelog to the docs site",
        reasoning: "Release notes are ready",
      }),
      "sentinel"
    );
  });

  it("lets explicit mode win over the heuristic", () => {
    assert.equal(
      routeDecision({
        mandate: "Deploy the API",
        proposed_action: "Deploy to production",
        reasoning: "Ship it",
        mode: "dql",
      }),
      "dql"
    );
    assert.equal(
      routeDecision({
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "sentinel",
      }),
      "sentinel"
    );
  });

  it("defaults unsure text to dql (hero path)", () => {
    assert.equal(
      routeDecision({
        mandate: "Summarize the meeting notes",
        proposed_action: "Write a short recap",
        reasoning: "Highlight the action items",
      }),
      "dql"
    );
  });
});

describe("executeAllowed", () => {
  it("is true only on ALLOW", () => {
    assert.equal(executeAllowed("ALLOW"), true);
    assert.equal(executeAllowed("allow"), true);
    assert.equal(executeAllowed("BLOCK"), false);
    assert.equal(executeAllowed("REVIEW"), false);
    assert.equal(executeAllowed("UNCERTAIN"), false);
    assert.equal(executeAllowed("ERROR"), false);
  });
});

describe("envelope mapping", () => {
  it("maps a fixture DQL response", () => {
    const env = mapDqlEnvelope(DQL_FIXTURE);
    assert.equal(env.verdict, "BLOCK");
    assert.equal(env.execute, false);
    assert.equal(env.surface, "dql");
    assert.equal(env.receipt_id, "dql_abc123_x7k9p2");
    assert.deepEqual(env.objections, [
      "Flight arrives in Munich, not Rome.",
      "Scope axis failed.",
    ]);
    assert.ok(env.axes);
    assert.equal(env.axes.length, 2);
    assert.equal(env.axes[1].verdict, "FAIL");
    assert.equal(env.axes[1].objection, "Flight arrives in Munich, not Rome.");
    assert.match(env.recommendation, /do not execute/);
  });

  it("maps a fixture Sentinel response", () => {
    const env = mapSentinelEnvelope(SENTINEL_FIXTURE);
    assert.equal(env.verdict, "UNCERTAIN");
    assert.equal(env.execute, false);
    assert.equal(env.surface, "sentinel");
    assert.equal(env.receipt_id, "req_m1abc_x9f2kq");
    assert.ok(env.objections.includes("No test results cited."));
    assert.ok(env.objections.includes("Insufficient evidence for a production deploy."));
    assert.equal(env.axes, undefined);
    assert.match(env.recommendation, /replan from objections/);
  });

  it("sets execute true only when the native verdict is ALLOW", () => {
    const allowDql = mapDqlEnvelope({
      ...DQL_FIXTURE,
      axes: DQL_FIXTURE.axes.map((a) => ({ ...a, verdict: "PASS", objection: "" })),
      aggregate: { verdict: "ALLOW", rationale: "All axes passed." },
    });
    assert.equal(allowDql.execute, true);
    assert.equal(allowDql.recommendation, "execute");

    const reviewDql = mapDqlEnvelope({
      ...DQL_FIXTURE,
      aggregate: { verdict: "REVIEW", rationale: "Needs a human." },
    });
    assert.equal(reviewDql.execute, false);

    const uncertain = mapSentinelEnvelope(SENTINEL_FIXTURE);
    assert.equal(uncertain.execute, false);
  });
});

describe("DQL credential resolution", () => {
  it("env dqla_ resolves to the account header only", () => {
    const fromAccountEnv = resolveDqlCredential({
      DQL_ACCOUNT_TOKEN: "dqla_test",
    });
    assert.deepEqual(fromAccountEnv, { kind: "account", value: "dqla_test" });
    const headers = buildDqlAuthHeaders(fromAccountEnv);
    assert.equal(headers["X-DQL-Account"], "dqla_test");
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["X-DQL-Key"], undefined);
    assert.deepEqual(Object.keys(headers), ["X-DQL-Account"]);

    const fromApiKeyEnv = resolveDqlCredential({
      DQL_API_KEY: "dqla_via_api_key",
    });
    assert.deepEqual(fromApiKeyEnv, { kind: "account", value: "dqla_via_api_key" });
    assert.equal(buildDqlAuthHeaders(fromApiKeyEnv)["X-DQL-Key"], undefined);
  });

  it("env dqlk_ resolves to the existing key header only", () => {
    const auth = resolveDqlCredential({
      DQL_API_KEY: "dqlk_test",
    });
    assert.deepEqual(auth, { kind: "key", value: "dqlk_test" });
    const headers = buildDqlAuthHeaders(auth);
    assert.equal(headers["X-DQL-Key"], "dqlk_test");
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["X-DQL-Account"], undefined);
    assert.deepEqual(Object.keys(headers), ["X-DQL-Key"]);
  });

  it("prefers dqlk_ over dqla_ and never emits both headers", () => {
    const auth = resolveDqlCredential({
      DQL_API_KEY: "dqlk_test",
      DQL_ACCOUNT_TOKEN: "dqla_test",
    });
    assert.equal(auth.kind, "key");
    const headers = buildDqlAuthHeaders(auth);
    assert.equal(headers["X-DQL-Key"], "dqlk_test");
    assert.equal(headers["X-DQL-Account"], undefined);
    assert.equal(Object.values(headers).some((v) => String(v).startsWith("dqla_")), false);
  });
});

describe("callDql auth headers (mocked HTTP)", () => {
  const input = {
    mandate: "Buy milk under $5",
    proposed_action: "Purchase milk for $4",
    reasoning: "Under budget",
  };

  it("sends X-DQL-Account when auth is dqla_", async () => {
    let captured;
    await callDql(input, {
      auth: { kind: "account", value: "dqla_test" },
      fetchImpl: async (_url, init) => {
        captured = init.headers;
        return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
      },
    });
    assert.equal(captured["X-DQL-Account"], "dqla_test");
    assert.equal(captured["X-DQL-Key"], undefined);
    assert.equal(captured.Authorization, undefined);
  });

  it("sends X-DQL-Key when auth is dqlk_", async () => {
    let captured;
    await callDql(input, {
      auth: { kind: "key", value: "dqlk_test" },
      fetchImpl: async (_url, init) => {
        captured = init.headers;
        return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
      },
    });
    assert.equal(captured["X-DQL-Key"], "dqlk_test");
    assert.equal(captured["X-DQL-Account"], undefined);
    assert.equal(captured.Authorization, undefined);
  });
});

describe("verifyDecision fail-closed (mocked HTTP)", () => {
  it("does not hit the network when the DQL key is missing", async () => {
    let called = 0;
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
      },
      {
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      }
    );
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.surface, "dql");
    assert.match(env.objections.join(" "), /DQL key not configured/);
  });

  it("does not silently fall back to DQL when Sentinel key is missing", async () => {
    let called = 0;
    const env = await verifyDecision(
      {
        mandate: "Ship the release",
        proposed_action: "Deploy to production",
        reasoning: "CI is green",
        mode: "sentinel",
      },
      {
        dqlApiKey: "dqlk_should_not_be_used",
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      }
    );
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.equal(env.surface, "sentinel");
    assert.match(env.objections.join(" "), /Sentinel key not configured/);
  });

  it("maps HTTP 402 into execute:false with status text", async () => {
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
      },
      {
        dqlApiKey: "dqlk_test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "payment_required" }), {
            status: 402,
            statusText: "Payment Required",
          }),
      }
    );
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.match(env.objections.join(" "), /402/);
  });

  it("maps a mocked DQL ALLOW into execute:true", async () => {
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
      },
      {
        dqlApiKey: "dqlk_test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "dql_ok",
              axes: [
                { axis: "intent", verdict: "PASS", objection: "" },
              ],
              aggregate: { verdict: "ALLOW", rationale: "All axes passed." },
            }),
            { status: 200 }
          ),
      }
    );
    assert.equal(env.verdict, "ALLOW");
    assert.equal(env.execute, true);
    assert.equal(env.receipt_id, "dql_ok");
    assert.equal(env.surface, "dql");
  });

  it("does not send the account token when a dqlk_ key is also set", async () => {
    let captured;
    await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
      },
      {
        dqlApiKey: "dqlk_test",
        dqlAccountToken: "dqla_test",
        fetchImpl: async (_url, init) => {
          captured = init.headers;
          return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
        },
      }
    );
    assert.equal(captured["X-DQL-Key"], "dqlk_test");
    assert.equal(captured["X-DQL-Account"], undefined);
    assert.equal(captured.Authorization, undefined);
    assert.equal(
      Object.values(captured).some((v) => String(v).includes("dqla_")),
      false
    );
  });

  it("treats DQL_API_KEY=dqla_ as an account token", async () => {
    let captured;
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
      },
      {
        dqlApiKey: "dqla_via_key_env",
        fetchImpl: async (_url, init) => {
          captured = init.headers;
          return new Response(
            JSON.stringify({
              id: "dql_ok",
              axes: [{ axis: "intent", verdict: "PASS", objection: "" }],
              aggregate: { verdict: "ALLOW" },
            }),
            { status: 200 }
          );
        },
      }
    );
    assert.equal(captured["X-DQL-Account"], "dqla_via_key_env");
    assert.equal(captured["X-DQL-Key"], undefined);
    assert.equal(captured.Authorization, undefined);
    assert.equal(env.execute, true);
  });

  it("uses an account token when no dqlk_ is set", async () => {
    let captured;
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
      },
      {
        dqlAccountToken: "dqla_test",
        fetchImpl: async (_url, init) => {
          captured = init.headers;
          return new Response(
            JSON.stringify({
              id: "dql_ok",
              axes: [{ axis: "intent", verdict: "PASS", objection: "" }],
              aggregate: { verdict: "ALLOW", rationale: "All axes passed." },
            }),
            { status: 200 }
          );
        },
      }
    );
    assert.equal(captured["X-DQL-Account"], "dqla_test");
    assert.equal(captured["X-DQL-Key"], undefined);
    assert.equal(captured.Authorization, undefined);
    assert.equal(env.execute, true);
    assert.equal(env.verdict, "ALLOW");
  });
});
