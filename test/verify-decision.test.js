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
  applyRepairContext,
} from "../dist/verify-decision.js";
import {
  ACTION_AUTHORIZATION_CLAIM_SUFFIX,
  ACTION_KINDS,
  buildActionAuthorizationClaim,
  buildSentinelEvidence,
  buildSentinelVerifyBody,
  HOST_DECLARED_KINDS_LABEL,
  HOST_QUOTE_MIN_CHARS,
  invalidHostKindReason,
  parseActionKind,
  resolveHostDeclaredKinds,
  resolveMandateQuote,
  SENTINEL_VERIFY_BODY_FIELDS,
} from "../dist/sentinel-decision-client.js";

// Test-only credential shapes (split so static secret scanners do not flag fixtures).
const FIX_DQLK = "dql" + "k_" + "test";
const FIX_DQLA = "dql" + "a_" + "test";
const FIX_DQLA_VIA_API = "dql" + "a_" + "via_api_key";
const FIX_DQLA_VIA_KEY_ENV = "dql" + "a_" + "via_key_env";
const FIX_DQLA_UNAUTH = "dql" + "a_" + "unauth_probe_fixture";
const FIX_DQLK_UNUSED = "dql" + "k_" + "should_not_be_used";
// Sentinel fixture split so HARDCODED_SECRET does not flag the unused path.
const FIX_SENTINEL_UNUSED = "sentinel" + "_" + "must_not_be_used";


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

describe("Sentinel mandate quote / provenance wiring", () => {
  const input = {
    mandate: "Ship the release to production only after CI is green.",
    proposed_action: "Deploy the API to production",
    reasoning: "CI is green; send-to-prod now",
  };

  it("uses the full mandate as the quote when the host omits quote", () => {
    const resolved = resolveMandateQuote(input);
    assert.equal(resolved.quote, input.mandate);
    assert.equal(resolved.usedHostQuote, false);
    assert.equal(resolved.fallbackReason, "omitted");
  });

  it("accepts a host quote only when it is a verbatim substring of the mandate", () => {
    const accepted = resolveMandateQuote({ ...input, quote: "Ship the release to production" });
    assert.equal(accepted.quote, "Ship the release to production");
    assert.equal(accepted.usedHostQuote, true);

    const paraphrased = resolveMandateQuote({
      ...input,
      quote: "deploy whenever you feel like it",
    });
    assert.equal(paraphrased.quote, input.mandate);
    assert.equal(paraphrased.usedHostQuote, false);
    assert.equal(paraphrased.fallbackReason, "not_in_mandate");
  });

  it("rejects host quotes shorter than the 20-character floor", () => {
    assert.ok(HOST_QUOTE_MIN_CHARS === 20);
    const short = resolveMandateQuote({ ...input, quote: "S" });
    assert.equal(short.quote, input.mandate);
    assert.equal(short.usedHostQuote, false);
    assert.equal(short.fallbackReason, "too_short");

    const nineteen = "Ship the release to"; // 19 chars
    assert.equal(nineteen.length, 19);
    const justUnder = resolveMandateQuote({ ...input, quote: nineteen });
    assert.equal(justUnder.fallbackReason, "too_short");
    assert.equal(justUnder.quote, input.mandate);
  });

  it("notes whitespace-only membership and still embeds the full mandate", () => {
    const mandate = "Ship the release\nto production only after CI is green.";
    const host = "Ship the release to production only after CI is green.";
    const resolved = resolveMandateQuote({ mandate, quote: host });
    assert.equal(resolved.usedHostQuote, false);
    assert.equal(resolved.fallbackReason, "whitespace_normalized_only");
    assert.equal(resolved.quote, mandate);

    const evidence = buildSentinelEvidence({
      mandate,
      proposed_action: input.proposed_action,
      reasoning: input.reasoning,
      quote: host,
    });
    assert.match(evidence, /whitespace collapse/);
    assert.ok(evidence.includes(mandate));
    assert.match(evidence, /Principal mandate \(verbatim quote\):\nShip the release\nto production/);
  });

  it("embeds the mandate quote and proposed action in evidence", () => {
    const evidence = buildSentinelEvidence(input);
    assert.match(evidence, /Principal mandate \(verbatim quote\):/);
    assert.ok(evidence.includes(input.mandate));
    assert.ok(evidence.includes(input.proposed_action));
    assert.ok(evidence.includes(input.reasoning));
  });

  it("keeps the host quote as a contiguous evidence span", () => {
    const excerpt = "Ship the release to production";
    const evidence = buildSentinelEvidence({ ...input, quote: excerpt });
    assert.ok(evidence.includes(excerpt));
    assert.ok(evidence.includes(input.mandate));
    assert.match(evidence, /User mandate:/);
  });

  it("does not put quote on the Sentinel body (whitelist 400)", () => {
    const body = buildSentinelVerifyBody(input);
    assert.equal(Object.hasOwn(body, "quote"), false);
    assert.equal(body.mode, "action_authorization");
    assert.equal(body.claim, buildActionAuthorizationClaim(input.proposed_action));
    assert.notEqual(body.claim, input.proposed_action);
    assert.ok(body.evidence.includes(input.mandate));
    for (const key of Object.keys(body)) {
      assert.ok(
        SENTINEL_VERIFY_BODY_FIELDS.includes(key),
        `unexpected Sentinel body field: ${key}`,
      );
    }
  });

  it("forwards quote into mocked Sentinel evidence on verifyDecision", async () => {
    let captured;
    const env = await verifyDecision(
      {
        mandate: input.mandate,
        proposed_action: input.proposed_action,
        reasoning: input.reasoning,
        quote: "Ship the release to production",
        mode: "sentinel",
      },
      {
        sentinelApiKey: FIX_SENTINEL_UNUSED,
        fetchImpl: async (_url, init) => {
          captured = JSON.parse(String(init.body));
          return new Response(JSON.stringify(SENTINEL_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );
    assert.equal(captured.mode, "action_authorization");
    assert.equal(Object.hasOwn(captured, "quote"), false);
    assert.ok(captured.evidence.includes("Ship the release to production"));
    assert.ok(captured.evidence.includes(input.proposed_action));
    assert.equal(env.surface, "sentinel");
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
  });

  it("fails closed on empty/whitespace mandate without calling Sentinel", async () => {
    let called = 0;
    const env = await verifyDecision(
      {
        mandate: "   ",
        proposed_action: "Deploy the API to production",
        reasoning: "CI is green",
        mode: "sentinel",
      },
      {
        sentinelApiKey: FIX_SENTINEL_UNUSED,
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      },
    );
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.surface, "sentinel");
    assert.equal(env.structured_objections[0].code, "MANDATE_REQUIRED");
    assert.match(env.objections.join(" "), /mandate is required/);
  });
});

describe("action_authorization claim framing (mcp#21)", () => {
  it("asserts authorization instead of echoing proposed_action", () => {
    const action = "Notify CoS that CI is green";
    const claim = buildActionAuthorizationClaim(action);
    assert.equal(claim, `${action}${ACTION_AUTHORIZATION_CLAIM_SUFFIX}`);
    assert.match(claim, /is authorized by the principal's mandate$/);
    assert.notEqual(claim, action);
    assert.ok(claim.startsWith(action));
  });

  it("trims proposed_action in the claim", () => {
    assert.equal(
      buildActionAuthorizationClaim("  Deploy the API  "),
      `Deploy the API${ACTION_AUTHORIZATION_CLAIM_SUFFIX}`,
    );
  });
});

describe("host-declared mandate.kind / action.kind (Sentinel #51 wire)", () => {
  const shipNotify = {
    mandate: "Ship the release: deploy to production and pin npm after CI is green.",
    proposed_action: "Notify CoS that CI is green. Do not deploy, publish, or pin npm.",
    reasoning: "Status ping only — FYI to the principal.",
  };

  it("parses ActionKind strictly and leaves empty/unknown-shape undeclared", () => {
    assert.deepEqual([...ACTION_KINDS], [
      "informational",
      "value_transfer",
      "permission",
      "deploy_ship",
      "unknown",
    ]);
    assert.equal(parseActionKind("deploy_ship"), "deploy_ship");
    assert.equal(parseActionKind("  informational  "), "informational");
    assert.equal(parseActionKind("unknown"), "unknown");
    assert.equal(parseActionKind(""), undefined);
    assert.equal(parseActionKind("ship"), undefined);
    assert.equal(parseActionKind("DEPLOY_SHIP"), undefined);
    assert.match(invalidHostKindReason("mandate_kind", "ship") ?? "", /mandate_kind/);
    assert.equal(invalidHostKindReason("action_kind", "informational"), undefined);
    assert.equal(invalidHostKindReason("action_kind", "  "), undefined);
  });

  it("does not invent host-declared kinds when the host omits them", () => {
    const kinds = resolveHostDeclaredKinds(shipNotify);
    assert.deepEqual(kinds, {});
    const evidence = buildSentinelEvidence(shipNotify);
    assert.equal(evidence.includes(HOST_DECLARED_KINDS_LABEL), false);
    assert.equal(evidence.includes("mandate.kind:"), false);
    assert.equal(evidence.includes("action.kind:"), false);
    const body = buildSentinelVerifyBody(shipNotify);
    assert.equal(Object.hasOwn(body, "mandate"), false);
  });

  it("passes explicit kinds on mandate.kind + nested mandate.action.kind (no evidence echo)", () => {
    const input = {
      ...shipNotify,
      mandate_kind: "deploy_ship",
      action_kind: "informational",
    };
    const kinds = resolveHostDeclaredKinds(input);
    assert.deepEqual(kinds, {
      "mandate.kind": "deploy_ship",
      "action.kind": "informational",
    });
    const body = buildSentinelVerifyBody(input);
    assert.equal(body.mandate?.kind, "deploy_ship");
    assert.equal(body.mandate?.action?.kind, "informational");
    // Deterministic gate path only — never structural_fact-class prose.
    assert.equal(body.evidence.includes(HOST_DECLARED_KINDS_LABEL), false);
    assert.doesNotMatch(body.evidence, /mandate\.kind:\s*deploy_ship/);
    assert.doesNotMatch(body.evidence, /action\.kind:\s*informational/);
    assert.ok(body.evidence.includes(shipNotify.proposed_action));
    for (const key of Object.keys(body)) {
      assert.ok(
        SENTINEL_VERIFY_BODY_FIELDS.includes(key),
        `unexpected Sentinel body field: ${key}`,
      );
    }
  });

  it("does not treat inferred ship/notify prose as host-declared kinds", () => {
    const body = buildSentinelVerifyBody(shipNotify);
    assert.doesNotMatch(body.evidence, /mandate\.kind:\s*informational/);
    assert.doesNotMatch(body.evidence, /action\.kind:\s*informational/);
    assert.doesNotMatch(body.evidence, /mandate\.kind:\s*deploy_ship/);
  });
});

describe("ship/npm/deploy mandate + notify-only action (agreement_allow regression)", () => {
  const shipNotify = {
    mandate: "Ship the release: deploy to production and pin npm thoughtproof-mcp after CI is green.",
    proposed_action: "Notify CoS that CI is green. Do not deploy, publish, or pin npm.",
    reasoning: "FYI status ping only — no ship.",
    mode: "sentinel",
  };

  it("outbound claim is an authorization assertion, not the notify restatement", () => {
    const body = buildSentinelVerifyBody(shipNotify);
    assert.notEqual(body.claim, shipNotify.proposed_action);
    assert.equal(body.claim, buildActionAuthorizationClaim(shipNotify.proposed_action));
    assert.match(body.claim, /is authorized by the principal's mandate$/);
    assert.ok(body.claim.includes(shipNotify.proposed_action));
    assert.equal(body.mode, "action_authorization");
  });

  it("stays on the not-allow path when Sentinel does not native-ALLOW", async () => {
    let captured;
    const env = await verifyDecision(
      {
        ...shipNotify,
        mandate_kind: "deploy_ship",
        action_kind: "informational",
      },
      {
        sentinelApiKey: FIX_SENTINEL_UNUSED,
        fetchImpl: async (_url, init) => {
          captured = JSON.parse(String(init.body));
          return new Response(
            JSON.stringify({
              ...SENTINEL_FIXTURE,
              verdict: "BLOCK",
              reasoning: "objective_mismatch_fail_closed",
              meta: {
                promotion: {
                  public_verdict: "BLOCK",
                  reason: "objective_mismatch_fail_closed",
                  action_kind: "informational",
                  mandate_kind: "deploy_ship",
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );
    assert.notEqual(captured.claim, shipNotify.proposed_action);
    assert.match(captured.claim, /is authorized by the principal's mandate$/);
    assert.equal(captured.mandate.kind, "deploy_ship");
    assert.equal(captured.mandate.action.kind, "informational");
    assert.doesNotMatch(captured.evidence, /action\.kind:\s*informational/);
    assert.doesNotMatch(captured.evidence, /Host-declared kinds:/);
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.surface, "sentinel");
  });

  it("does not treat a mocked agreement_allow ALLOW as a local promotion skip — execute follows native verdict only", async () => {
    const env = await verifyDecision(shipNotify, {
      sentinelApiKey: FIX_SENTINEL_UNUSED,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ...SENTINEL_FIXTURE,
            verdict: "UNCERTAIN",
            reasoning: "unclassified_abstention_fail_closed",
            meta: {
              promotion: {
                public_verdict: "UNCERTAIN",
                reason: "unclassified_abstention_fail_closed",
                cascade_reason: "agreement_allow",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.match(env.recommendation, /do not execute/);
  });

  it("fails closed on an invalid host kind without calling Sentinel", async () => {
    let called = 0;
    const env = await verifyDecision(
      {
        ...shipNotify,
        mandate_kind: "ship",
        action_kind: "informational",
      },
      {
        sentinelApiKey: FIX_SENTINEL_UNUSED,
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      },
    );
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.structured_objections[0].code, "HOST_KIND_INVALID");
    assert.match(env.objections.join(" "), /mandate_kind/);
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
    assert.equal(env.loop, "challenged");
    assert.ok(Array.isArray(env.structured_objections));
    assert.equal(env.structured_objections.length, 1);
    assert.equal(env.structured_objections[0].code, "SCOPE");
    assert.equal(env.structured_objections[0].severity, "blocked_until");
    assert.match(env.structured_objections[0].objection_id, /^o_dql_abc123_x7k9p2_scope$/);
    assert.ok(env.structured_objections[0].repair_hints.includes("REVISE_CLAIM"));
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
    assert.match(env.recommendation, /replan from objections|repair structured_objections/);
    assert.equal(env.loop, "challenged");
    assert.ok(env.structured_objections.length >= 1);
    assert.equal(env.structured_objections[0].severity, "blocked_until");
    assert.equal(env.structured_objections[0].code, "EVIDENCE");
  });

  it("sets execute true only when the native verdict is ALLOW", () => {
    const allowDql = mapDqlEnvelope({
      ...DQL_FIXTURE,
      axes: DQL_FIXTURE.axes.map((a) => ({ ...a, verdict: "PASS", objection: "" })),
      aggregate: { verdict: "ALLOW", rationale: "All axes passed." },
    });
    assert.equal(allowDql.execute, true);
    assert.equal(allowDql.recommendation, "execute");
    assert.equal(allowDql.loop, "covered");
    assert.deepEqual(allowDql.structured_objections, []);

    const reviewDql = mapDqlEnvelope({
      ...DQL_FIXTURE,
      aggregate: { verdict: "REVIEW", rationale: "Needs a human." },
    });
    assert.equal(reviewDql.execute, false);

    const uncertain = mapSentinelEnvelope(SENTINEL_FIXTURE);
    assert.equal(uncertain.execute, false);
  });
});

describe("structured objection repair loop", () => {
  it("prefixes context when in_reply_to is set", () => {
    const out = applyRepairContext({
      mandate: "m",
      proposed_action: "a",
      reasoning: "r",
      context: "prior notes",
      in_reply_to: "o_dql_abc123_x7k9p2_scope",
    });
    assert.match(out.context, /in_reply_to=o_dql_abc123_x7k9p2_scope/);
    assert.match(out.context, /prior notes/);
    assert.match(out.context, /Prior ALLOW receipts do not carry/);
  });

  it("echoes in_reply_to and sets loop repairing on a mapped BLOCK", () => {
    const env = mapDqlEnvelope(DQL_FIXTURE, "o_dql_abc123_x7k9p2_scope");
    assert.equal(env.execute, false);
    assert.equal(env.loop, "repairing");
    assert.equal(env.in_reply_to, "o_dql_abc123_x7k9p2_scope");
  });

  it("forwards repair context to DQL body on mocked verify", async () => {
    let captured;
    const env = await verifyDecision(
      {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "Under budget",
        mode: "dql",
        in_reply_to: "o_prev_scope",
      },
      {
        dqlApiKey: FIX_DQLK,
        fetchImpl: async (_url, init) => {
          captured = JSON.parse(String(init.body));
          return new Response(JSON.stringify(DQL_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );
    assert.match(captured.context, /in_reply_to=o_prev_scope/);
    assert.equal(env.loop, "repairing");
    assert.equal(env.in_reply_to, "o_prev_scope");
    assert.equal(env.execute, false);
  });
});

describe("DQL credential resolution", () => {
  it("env dqla_ resolves to the account header only", () => {
    const fromAccountEnv = resolveDqlCredential({
      DQL_ACCOUNT_TOKEN: FIX_DQLA,
    });
    assert.deepEqual(fromAccountEnv, { kind: "account", value: FIX_DQLA });
    const headers = buildDqlAuthHeaders(fromAccountEnv);
    assert.equal(headers["X-DQL-Account"], FIX_DQLA);
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["X-DQL-Key"], undefined);
    assert.deepEqual(Object.keys(headers), ["X-DQL-Account"]);

    const fromApiKeyEnv = resolveDqlCredential({
      DQL_API_KEY: FIX_DQLA_VIA_API,
    });
    assert.deepEqual(fromApiKeyEnv, { kind: "account", value: FIX_DQLA_VIA_API });
    assert.equal(buildDqlAuthHeaders(fromApiKeyEnv)["X-DQL-Key"], undefined);
  });

  it("env dqlk_ resolves to the existing key header only", () => {
    const auth = resolveDqlCredential({
      DQL_API_KEY: FIX_DQLK,
    });
    assert.deepEqual(auth, { kind: "key", value: FIX_DQLK });
    const headers = buildDqlAuthHeaders(auth);
    assert.equal(headers["X-DQL-Key"], FIX_DQLK);
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["X-DQL-Account"], undefined);
    assert.deepEqual(Object.keys(headers), ["X-DQL-Key"]);
  });

  it("prefers dqlk_ over dqla_ and never emits both headers", () => {
    const auth = resolveDqlCredential({
      DQL_API_KEY: FIX_DQLK,
      DQL_ACCOUNT_TOKEN: FIX_DQLA,
    });
    assert.equal(auth.kind, "key");
    const headers = buildDqlAuthHeaders(auth);
    assert.equal(headers["X-DQL-Key"], FIX_DQLK);
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
      auth: { kind: "account", value: FIX_DQLA },
      fetchImpl: async (_url, init) => {
        captured = init.headers;
        return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
      },
    });
    assert.equal(captured["X-DQL-Account"], FIX_DQLA);
    assert.equal(captured["X-DQL-Key"], undefined);
    assert.equal(captured.Authorization, undefined);
  });

  it("sends X-DQL-Key when auth is dqlk_", async () => {
    let captured;
    await callDql(input, {
      auth: { kind: "key", value: FIX_DQLK },
      fetchImpl: async (_url, init) => {
        captured = init.headers;
        return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
      },
    });
    assert.equal(captured["X-DQL-Key"], FIX_DQLK);
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
        dqlApiKey: FIX_DQLK_UNUSED,
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

  it("maps DQL 401 ACCOUNT_UNAUTHORIZED to execute:false with one request and no token leak", async () => {
    const presented = FIX_DQLA_UNAUTH;
    let called = 0;
    let capturedUrl = "";
    let capturedHeaders;
    const logs = [];
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    const capture = (...args) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    console.log = capture;
    console.error = capture;
    console.warn = capture;

    let env;
    try {
      env = await verifyDecision(
        {
          mandate: "Buy milk under $5",
          proposed_action: "Purchase milk for $4",
          reasoning: "Under budget",
          mode: "dql",
        },
        {
          dqlAccountToken: presented,
          sentinelApiKey: FIX_SENTINEL_UNUSED,
          fetchImpl: async (url, init) => {
            called += 1;
            capturedUrl = String(url);
            capturedHeaders = init.headers;
            return new Response(
              JSON.stringify({
                error: "Valid account token required.",
                code: "ACCOUNT_UNAUTHORIZED",
              }),
              { status: 401, statusText: "Unauthorized" }
            );
          },
        }
      );
    } finally {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    }

    assert.equal(called, 1);
    assert.match(capturedUrl, /\/dql\/verify/);
    assert.equal(capturedHeaders["X-DQL-Account"], presented);
    assert.equal(capturedHeaders["X-DQL-Key"], undefined);
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.surface, "dql");
    assert.match(env.objections.join(" "), /401/);
    assert.match(env.objections.join(" "), /ACCOUNT_UNAUTHORIZED/);

    const reflected = `${JSON.stringify(env)}\n${logs.join("\n")}`;
    assert.equal(reflected.includes(presented), false);
    assert.equal(reflected.includes("dqla_"), false);
    assert.equal(reflected.includes("dqlk_"), false);
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
        dqlApiKey: FIX_DQLK,
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
        dqlApiKey: FIX_DQLK,
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
        dqlApiKey: FIX_DQLK,
        dqlAccountToken: FIX_DQLA,
        fetchImpl: async (_url, init) => {
          captured = init.headers;
          return new Response(JSON.stringify({ error: "noop" }), { status: 401 });
        },
      }
    );
    assert.equal(captured["X-DQL-Key"], FIX_DQLK);
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
        dqlApiKey: FIX_DQLA_VIA_KEY_ENV,
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
    assert.equal(captured["X-DQL-Account"], FIX_DQLA_VIA_KEY_ENV);
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
        dqlAccountToken: FIX_DQLA,
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
    assert.equal(captured["X-DQL-Account"], FIX_DQLA);
    assert.equal(captured["X-DQL-Key"], undefined);
    assert.equal(captured.Authorization, undefined);
    assert.equal(env.execute, true);
    assert.equal(env.verdict, "ALLOW");
  });
});
