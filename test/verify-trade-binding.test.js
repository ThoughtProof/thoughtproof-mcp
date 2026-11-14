/**
 * verify_trade uses the same requestHash contract as verify_decision.
 * Signatures here are synthetic: an ephemeral ed25519 key created in this
 * process. They are not production evidence and not the ...-vector key.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTradeVerifyBody, verifyTrade } from "../dist/verify-client.js";
import { computeRequestHash } from "../dist/request-binding.js";
import {
  buildExportSignedInput,
  canonicalJsonFlat,
  digestTransportedCanonical,
} from "../dist/signed-export.js";

const NOW = 1793102400;
const RECEIPT = "sent_trade_binding_synthetic";
const FIX_KEY = "sentinel" + "_" + "trade_binding_only";

const TRADE = {
  action: "open 1x long",
  thesis: "trend holds",
  reasoning: "higher highs",
  stakeLevel: "micro",
};

function keyDoc(publicKey) {
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
      },
    ],
  };
}

function issue(privateKey, verdict, requestBody) {
  const canonical = canonicalJsonFlat({
    artifactSchema: "sentinel.verdict.canonical.v1",
    verificationId: RECEIPT,
    verdict,
    ...(requestBody ? { requestHash: computeRequestHash(requestBody) } : {}),
  });
  const digest = digestTransportedCanonical(canonical);
  const fields = {
    artifactSchema: "sentinel.verdict.canonical.v1",
    verificationId: RECEIPT,
    canonical,
    digest,
    keyId: "local-test-only",
    alg: "Ed25519",
    signedAt: NOW,
    validUntil: NOW + 60,
  };
  return {
    exportSchema: "thoughtproof.sentinel.export.v1",
    ...fields,
    signature: `0x${sign(null, buildExportSignedInput(fields), privateKey).toString("hex")}`,
  };
}

function allowResponse(artifact) {
  return {
    id: RECEIPT,
    verdict: "ALLOW",
    confidence: 1,
    reasoning: "Synthetic offline trade decision",
    objections: [],
    mode: "trade_execution",
    tier: "checkpoint",
    signed_export: artifact,
  };
}

describe("verify_trade request binding", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = keyDoc(publicKey);
  const body = buildTradeVerifyBody(TRADE, "checkpoint");

  it("micro path ALLOWs a synthetic export whose requestHash matches the built body", async () => {
    let rv = 0;
    let sent = "";
    const result = await verifyTrade(TRADE, {
      apiKey: FIX_KEY,
      signedBinding: { keysDoc: keys, nowSeconds: NOW, env: {} },
      fetchImpl: async (url, init) => {
        if (String(url).includes("/v1/check")) {
          rv += 1;
          return new Response("{}", { status: 200 });
        }
        sent = String(init.body);
        assert.equal(init.redirect, "manual");
        return new Response(JSON.stringify(allowResponse(issue(privateKey, "ALLOW", body))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(JSON.parse(sent).claim, body.claim);
    assert.deepEqual(JSON.parse(sent), body);
    assert.equal(result.verdict, "ALLOW");
    assert.match(result.recommendation, /Safe to execute/);
    assert.equal(rv, 0);
    assert.equal(JSON.stringify(result).includes(FIX_KEY), false);
  });

  it("missing requestHash stays closed and does not call RV", async () => {
    let rv = 0;
    let fetches = 0;
    const result = await verifyTrade({ ...TRADE, stakeLevel: "high" }, {
      apiKey: FIX_KEY,
      signedBinding: { keysDoc: keys, nowSeconds: NOW, env: {} },
      fetchImpl: async (url) => {
        fetches += 1;
        if (String(url).includes("/v1/check")) {
          rv += 1;
          return new Response(JSON.stringify({ verdict: "ALLOW" }), { status: 200 });
        }
        return new Response(JSON.stringify(allowResponse(issue(privateKey, "ALLOW"))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(fetches, 1);
    assert.equal(rv, 0);
    assert.notEqual(result.verdict, "ALLOW");
    assert.equal(result.verdict, "UNCERTAIN");
    assert.doesNotMatch(result.recommendation, /Safe to execute/);
  });

  it("mismatched requestHash stays closed and does not call RV", async () => {
    let rv = 0;
    const other = buildTradeVerifyBody({ ...TRADE, action: "open 1x long " }, "checkpoint");
    const result = await verifyTrade(TRADE, {
      apiKey: FIX_KEY,
      signedBinding: { keysDoc: keys, nowSeconds: NOW, env: {} },
      fetchImpl: async (url) => {
        if (String(url).includes("/v1/check")) {
          rv += 1;
          return new Response(JSON.stringify({ verdict: "ALLOW" }), { status: 200 });
        }
        return new Response(JSON.stringify(allowResponse(issue(privateKey, "ALLOW", other))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(rv, 0);
    assert.notEqual(result.verdict, "ALLOW");
    assert.equal(computeRequestHash(body) === computeRequestHash(other), false);
  });

  it("missing test address does not fetch", async () => {
    let fetches = 0;
    const result = await verifyTrade(TRADE, {
      apiKey: FIX_KEY,
      sentinelTestMode: true,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("fetch must not run");
      },
    });
    assert.equal(fetches, 0);
    assert.notEqual(result.verdict, "ALLOW");
    assert.match(result.objections[0].explanation, /SENTINEL_TEST_MODE requires SENTINEL_URL/);
  });

  it("does not follow redirects or send credentials to a foreign origin", async () => {
    const seen = [];
    await assert.rejects(
      () =>
        verifyTrade(TRADE, {
          apiKey: FIX_KEY,
          x402PaymentSignature: "pay-sig-test-only",
          sentinelUrl: "https://deploy.example/sentinel/verify",
          deploymentProtection: {
            name: "x-deployment-protection",
            value: "test-bypass-not-a-secret",
            origin: "https://deploy.example",
          },
          fetchImpl: async (url, init) => {
            seen.push({ url: String(url), headers: { ...init.headers }, redirect: init.redirect });
            return new Response(null, {
              status: 307,
              headers: { Location: "https://evil.example/collect" },
            });
          },
        }),
      /redirect refused/,
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://deploy.example/sentinel/verify");
    assert.equal(seen[0].redirect, "manual");
    assert.equal(seen[0].headers["X-Sentinel-Key"], FIX_KEY);
    assert.equal(seen[0].headers["x-deployment-protection"], "test-bypass-not-a-secret");

    const foreign = [];
    await verifyTrade(TRADE, {
      apiKey: FIX_KEY,
      x402PaymentSignature: "pay-sig-test-only",
      sentinelUrl: "https://other.example/sentinel/verify",
      deploymentProtection: {
        name: "x-deployment-protection",
        value: "test-bypass-not-a-secret",
        origin: "https://deploy.example",
      },
      fetchImpl: async (url, init) => {
        foreign.push({ url: String(url), headers: { ...init.headers } });
        return new Response(JSON.stringify({ id: "x", verdict: "BLOCK", reasoning: "no" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(foreign.length, 1);
    assert.equal(foreign[0].headers["X-Sentinel-Key"], undefined);
    assert.equal(foreign[0].headers["PAYMENT-SIGNATURE"], undefined);
    assert.equal(foreign[0].headers["x-deployment-protection"], undefined);
    assert.equal(JSON.stringify(foreign).includes("test-bypass-not-a-secret"), false);
    assert.equal(JSON.stringify(foreign).includes("pay-sig-test-only"), false);
  });

  it("signed UNCERTAIN without a matching requestHash does not reach RV", async () => {
    const cases = [
      { name: "missing", artifact: issue(privateKey, "UNCERTAIN") },
      {
        name: "wrong",
        artifact: issue(privateKey, "UNCERTAIN", buildTradeVerifyBody({ ...TRADE, action: "other" }, "checkpoint")),
      },
    ];
    for (const stakeLevel of ["high", "micro"]) {
      for (const item of cases) {
        let rv = 0;
        const result = await verifyTrade({ ...TRADE, stakeLevel }, {
          apiKey: FIX_KEY,
          signedBinding: { keysDoc: keys, nowSeconds: NOW, env: {} },
          fetchImpl: async (url) => {
            if (String(url).includes("/v1/check")) {
              rv += 1;
              return new Response(JSON.stringify({ verdict: "ALLOW", summary: "would allow" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(
              JSON.stringify({ ...allowResponse(item.artifact), verdict: "UNCERTAIN" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          },
        });
        assert.equal(rv, 0, `${stakeLevel} ${item.name}`);
        assert.equal(result.verdict, "UNCERTAIN", `${stakeLevel} ${item.name}`);
        assert.doesNotMatch(result.recommendation, /Safe to execute/);
      }
    }
  });

  it("signed UNCERTAIN with a matching requestHash may still escalate", async () => {
    let rv = 0;
    const result = await verifyTrade({ ...TRADE, stakeLevel: "high" }, {
      apiKey: FIX_KEY,
      signedBinding: { keysDoc: keys, nowSeconds: NOW, env: {} },
      fetchImpl: async (url) => {
        if (String(url).includes("/v1/check")) {
          rv += 1;
          return new Response(JSON.stringify({ verdict: "ALLOW", summary: "panel allow" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            ...allowResponse(issue(privateKey, "UNCERTAIN", body)),
            verdict: "UNCERTAIN",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    assert.equal(rv, 1);
    assert.equal(result.verdict, "ALLOW");
  });

  it("a lone surrogate is not sent", async () => {
    let fetches = 0;
    const result = await verifyTrade(
      { ...TRADE, reasoning: "higher\uD800highs" },
      {
        apiKey: FIX_KEY,
        fetchImpl: async () => {
          fetches += 1;
          throw new Error("fetch must not run");
        },
      },
    );
    assert.equal(fetches, 0);
    assert.equal(result.verdict, "UNCERTAIN");
    assert.match(result.objections[0].explanation, /request binding rejected/);
  });
});
