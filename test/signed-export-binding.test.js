/**
 * Regression for the 2026-10-27 enforcement audit counterexample:
 * a validly signed BLOCK plus an outer verdict ALLOW must not execute.
 * Ports production-boundaries.test.mjs "MCP envelope also follows unsigned
 * ALLOW over signed BLOCK" into the fail-closed expectation.
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapSentinelEnvelope, verifyDecision } from "../dist/verify-decision.js";
import { verifyTrade } from "../dist/verify-client.js";
import {
  assessSentinelBinding,
  buildExportSignedInput,
  canonicalJsonFlat,
  digestTransportedCanonical,
  signedBindingRequired,
} from "../dist/signed-export.js";

const NOW = 1793102400;
const RECEIPT = "sent_offline_enforcement";
const FIX_SENTINEL = "sentinel" + "_" + "binding_test_only";

function keyDoc(publicKey, overrides = {}) {
  const jwk = publicKey.export({ format: "jwk" });
  return {
    schema: "thoughtproof.keys.v1",
    keys: [
      {
        kty: "OKP",
        crv: "Ed25519",
        x: jwk.x,
        kid: "local-test-only",
        alg: "EdDSA",
        status: "active",
        notBefore: "2020-01-01T00:00:00Z",
        notAfter: null,
        ...overrides,
      },
    ],
  };
}

function issue(privateKey, verdict, options = {}) {
  const schema = options.schema ?? "sentinel.verdict.canonical.v1";
  const verificationId = options.verificationId ?? RECEIPT;
  const keyId = options.keyId ?? "local-test-only";
  const canonical = canonicalJsonFlat({
    artifactSchema: schema,
    verificationId,
    verdict,
  });
  const digest = digestTransportedCanonical(canonical);
  const fields = {
    artifactSchema: schema,
    verificationId,
    canonical,
    digest,
    keyId,
    alg: "Ed25519",
    signedAt: options.signedAt ?? NOW,
    validUntil: options.validUntil === null ? undefined : (options.validUntil ?? NOW + 60),
  };
  const signature = `0x${sign(null, buildExportSignedInput(fields), privateKey).toString("hex")}`;
  return {
    exportSchema: "thoughtproof.sentinel.export.v1",
    ...fields,
    signature,
  };
}

function response(verdict = "BLOCK") {
  return {
    id: RECEIPT,
    verdict,
    confidence: 1,
    reasoning: "Synthetic offline decision",
    objections: [],
    mode: "action_authorization",
    tier: "standard",
    meta: {
      duration_ms: 1,
      models_used: [],
      verified_at: new Date(NOW * 1000).toISOString(),
    },
  };
}

function bind(keys) {
  return { keysDoc: keys, nowSeconds: NOW, requireSignedBinding: true, env: {} };
}

describe("signed export binding", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = keyDoc(publicKey);

  it("requires signed binding by default", () => {
    assert.equal(signedBindingRequired({}), true);
    assert.equal(signedBindingRequired({ TP_REQUIRE_SIGNED_BINDING: "1" }), true);
    assert.equal(signedBindingRequired({ TP_REQUIRE_SIGNED_BINDING: "0" }), false);
    assert.equal(signedBindingRequired({ TP_REQUIRE_SIGNED_BINDING: "false" }), false);
  });

  it("audit counterexample: signed BLOCK with outer ALLOW does not execute", () => {
    const artifact = issue(privateKey, "BLOCK");
    assert.equal(JSON.parse(artifact.canonical).verdict, "BLOCK");
    const envelope = mapSentinelEnvelope(
      { ...response("BLOCK"), signed_export: artifact, verdict: "ALLOW" },
      undefined,
      bind(keys),
    );
    assert.equal(envelope.execute, false);
    assert.notEqual(envelope.verdict, "ALLOW");
    assert.match(envelope.recommendation, /do not execute/);
    assert.match(envelope.objections.join(" "), /verdict_mismatch/);
  });

  it("verifyDecision returns execute false for the same counterexample", async () => {
    const artifact = issue(privateKey, "BLOCK");
    const env = await verifyDecision(
      {
        mandate: "Do not ship",
        proposed_action: "Deploy the release",
        reasoning: "CI is green",
        mode: "sentinel",
      },
      {
        sentinelApiKey: FIX_SENTINEL,
        signedBinding: bind(keys),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ ...response("BLOCK"), signed_export: artifact, verdict: "ALLOW" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    );
    assert.equal(env.execute, false);
    assert.notEqual(env.verdict, "ALLOW");
    assert.equal(env.surface, "sentinel");
    assert.equal(JSON.stringify(env).includes(FIX_SENTINEL), false);
  });

  it("executes only when the signed verdict is ALLOW and matches", () => {
    const artifact = issue(privateKey, "ALLOW");
    const envelope = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: artifact },
      undefined,
      bind(keys),
    );
    assert.equal(envelope.execute, true);
    assert.equal(envelope.verdict, "ALLOW");
    assert.equal(envelope.recommendation, "execute");
  });

  it("does not upgrade a signed non-ALLOW, including when the outer verdict is ALLOW", () => {
    for (const verdict of ["BLOCK", "UNCERTAIN", "HOLD", "REVIEW"]) {
      const matching = mapSentinelEnvelope(
        { ...response(verdict), signed_export: issue(privateKey, verdict) },
        undefined,
        bind(keys),
      );
      assert.equal(matching.execute, false, verdict);
      assert.notEqual(matching.verdict, "ALLOW");

      const contradicted = mapSentinelEnvelope(
        { ...response(verdict), signed_export: issue(privateKey, verdict), verdict: "ALLOW" },
        undefined,
        bind(keys),
      );
      assert.equal(contradicted.execute, false, `${verdict} vs ALLOW`);
      assert.notEqual(contradicted.verdict, "ALLOW");
    }

    const signedAllowOuterBlock = mapSentinelEnvelope(
      { ...response("BLOCK"), signed_export: issue(privateKey, "ALLOW") },
      undefined,
      bind(keys),
    );
    assert.equal(signedAllowOuterBlock.execute, false);
    assert.notEqual(signedAllowOuterBlock.verdict, "ALLOW");
  });

  it("fails closed on a missing, invalid, unknown, or expired signature", () => {
    const missing = mapSentinelEnvelope(response("ALLOW"), undefined, bind(keys));
    assert.equal(missing.execute, false);
    assert.notEqual(missing.verdict, "ALLOW");

    const artifact = issue(privateKey, "ALLOW");
    const flipped = `0x${(artifact.signature.slice(2, 3) === "a" ? "b" : "a")}${artifact.signature.slice(3)}`;
    const invalid = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: { ...artifact, signature: flipped } },
      undefined,
      bind(keys),
    );
    assert.equal(invalid.execute, false);
    assert.match(invalid.objections.join(" "), /signature_invalid/);

    const unknown = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: issue(privateKey, "ALLOW", { keyId: "not-a-pinned-kid" }) },
      undefined,
      bind(keys),
    );
    assert.equal(unknown.execute, false);
    assert.match(unknown.objections.join(" "), /key_not_found/);

    const expired = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: artifact },
      undefined,
      { ...bind(keys), nowSeconds: NOW + 120 },
    );
    assert.equal(expired.execute, false);
    assert.match(expired.objections.join(" "), /expired/);
  });

  it("rejects the vector-only kid and the validation-keys trust root", () => {
    const vectorKeys = keyDoc(publicKey, { status: "vector-only", kid: "local-test-only" });
    const vector = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: issue(privateKey, "ALLOW") },
      undefined,
      bind(vectorKeys),
    );
    assert.equal(vector.execute, false);
    assert.match(vector.objections.join(" "), /vector_only_key_not_allowed/);

    const validation = assessSentinelBinding(
      {
        ...response("ALLOW"),
        signed_export: issue(privateKey, "ALLOW", { keyId: "tp-validation-ed25519-2026-07" }),
      },
      bind(keys),
    );
    assert.equal(validation.ok, false);
    assert.equal(validation.code, "validation_key_not_export_signer");
    const envelope = mapSentinelEnvelope(
      {
        ...response("ALLOW"),
        signed_export: issue(privateKey, "ALLOW", { keyId: "tp-validation-ed25519-2026-07" }),
      },
      undefined,
      bind(keys),
    );
    assert.equal(envelope.execute, false);
  });

  it("accepts a retired key inside its signedAt window and rejects a not-yet-valid key", () => {
    const retired = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: issue(privateKey, "ALLOW") },
      undefined,
      bind(keyDoc(publicKey, { status: "retired" })),
    );
    assert.equal(retired.execute, true);

    const early = mapSentinelEnvelope(
      { ...response("ALLOW"), signed_export: issue(privateKey, "ALLOW") },
      undefined,
      bind(keyDoc(publicKey, { notBefore: "2027-01-01T00:00:00Z" })),
    );
    assert.equal(early.execute, false);
    assert.match(early.objections.join(" "), /key_not_yet_valid/);
  });

  it("fails closed when verificationId does not match the response id", () => {
    const envelope = mapSentinelEnvelope(
      {
        ...response("ALLOW"),
        signed_export: issue(privateKey, "ALLOW", { verificationId: "other-receipt" }),
      },
      undefined,
      bind(keys),
    );
    assert.equal(envelope.execute, false);
    assert.match(envelope.objections.join(" "), /receipt_mismatch/);
  });

  it("fails closed when v1 and v2 signed verdicts disagree", () => {
    const envelope = mapSentinelEnvelope(
      {
        ...response("ALLOW"),
        signed_export: issue(privateKey, "ALLOW"),
        signed_export_v2: issue(privateKey, "BLOCK", {
          schema: "sentinel.verdict.canonical.v2",
        }),
      },
      undefined,
      bind(keys),
    );
    assert.equal(envelope.execute, false);
    assert.notEqual(envelope.verdict, "ALLOW");
  });

  it("compatibility flag defaults fail-closed and can trust the outer verdict only when set off", () => {
    const unsigned = mapSentinelEnvelope(response("ALLOW"), undefined, {
      env: {},
    });
    assert.equal(unsigned.execute, false);

    const legacy = mapSentinelEnvelope(response("ALLOW"), undefined, {
      requireSignedBinding: false,
      env: { TP_REQUIRE_SIGNED_BINDING: "0" },
    });
    assert.equal(legacy.execute, true);
    assert.equal(legacy.verdict, "ALLOW");
  });

  it("maps Sentinel 401, 429, and 5xx to execute false", async () => {
    const input = {
      mandate: "Ship the release",
      proposed_action: "Deploy to production",
      reasoning: "CI is green",
      mode: "sentinel",
    };
    for (const status of [401, 429, 500, 503]) {
      const env = await verifyDecision(input, {
        sentinelApiKey: FIX_SENTINEL,
        signedBinding: bind(keys),
        fetchImpl: async () =>
          new Response(JSON.stringify({ ...response("ALLOW"), verdict: "ALLOW" }), {
            status,
            statusText: "no",
          }),
      });
      assert.equal(env.execute, false, String(status));
      assert.notEqual(env.verdict, "ALLOW");
      assert.match(env.objections.join(" "), new RegExp(String(status)));
      assert.equal(JSON.stringify(env).includes(FIX_SENTINEL), false);
    }
  });

  it("verify_trade does not treat the counterexample as safe to execute", async () => {
    const artifact = issue(privateKey, "BLOCK");
    let rvCalled = 0;
    const result = await verifyTrade(
      {
        action: "open 1x long",
        thesis: "trend",
        reasoning: "higher highs",
        stakeLevel: "high",
      },
      {
        apiKey: FIX_SENTINEL,
        signedBinding: bind(keys),
        fetchImpl: async (url) => {
          if (String(url).includes("/v1/check")) {
            rvCalled += 1;
            return new Response(JSON.stringify({ verdict: "ALLOW", summary: "no" }), { status: 200 });
          }
          return new Response(
            JSON.stringify({ ...response("BLOCK"), signed_export: artifact, verdict: "ALLOW" }),
            { status: 200 },
          );
        },
      },
    );
    assert.notEqual(result.verdict, "ALLOW");
    assert.doesNotMatch(result.recommendation, /Safe to execute/);
    assert.equal(rvCalled, 0);
    assert.equal(JSON.stringify(result).includes(FIX_SENTINEL), false);
  });

  it("verify_trade fail-closes 401, 429, and 5xx without an ALLOW verdict", async () => {
    for (const status of [401, 429, 500]) {
      await assert.rejects(
        verifyTrade(
          {
            action: "open 1x long",
            thesis: "trend",
            reasoning: "higher highs",
            stakeLevel: "micro",
          },
          {
            apiKey: FIX_SENTINEL,
            fetchImpl: async () => new Response("unavailable", { status }),
          },
        ),
        (err) => {
          assert.match(String(err), new RegExp(String(status)));
          assert.equal(String(err).includes(FIX_SENTINEL), false);
          assert.doesNotMatch(String(err), /Safe to execute/);
          return true;
        },
      );
    }
  });
});

describe("signed export digest pin", () => {
  it("hashes the transported canonical string and not a reordered object", () => {
    const canonical = canonicalJsonFlat({
      artifactSchema: "sentinel.verdict.canonical.v1",
      verificationId: RECEIPT,
      verdict: "BLOCK",
    });
    const digest = digestTransportedCanonical(canonical);
    assert.equal(digest, `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`);
    assert.equal(canonical.indexOf('"verdict":"BLOCK"') > 0, true);
  });
});
