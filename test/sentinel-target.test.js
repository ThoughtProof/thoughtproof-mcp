/**
 * Sentinel target wiring. Offline. fetchImpl is the only transport.
 * The offline guard fails the process if global fetch is used.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callSentinelDecision, SENTINEL_VERIFY_URL } from "../dist/sentinel-decision-client.js";
import {
  resolveSentinelTarget,
  SENTINEL_TEST_URL_REQUIRED,
} from "../dist/sentinel-target.js";
import { verifyDecision } from "../dist/verify-decision.js";

const FIX_KEY = "sentinel" + "_" + "target_test_only";
const INPUT = {
  mandate: "Inspect the repo.",
  proposed_action: "run_command: git status",
  reasoning: "Read-only status.",
  mode: "sentinel",
};

function sentinelBody(verdict = "UNCERTAIN") {
  return {
    id: "req_target_offline",
    verdict,
    reasoning: "Synthetic offline decision",
    objections: [],
    mode: "action_authorization",
    tier: "checkpoint",
  };
}

describe("sentinel target", () => {
  it("test mode with no address aborts before fetch", async () => {
    let called = 0;
    const env = await verifyDecision(INPUT, {
      sentinelTestMode: true,
      sentinelApiKey: FIX_KEY,
      fetchImpl: async () => {
        called += 1;
        throw new Error("fetch must not run");
      },
    });
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.equal(env.surface, "sentinel");
    assert.equal(env.structured_objections[0].code, "SENTINEL_URL_REQUIRED");
    assert.match(env.objections.join(" "), /SENTINEL_TEST_MODE requires SENTINEL_URL/);
    assert.equal(env.objections.join(" ").includes(FIX_KEY), false);

    const direct = await callSentinelDecision(INPUT, {
      apiKey: FIX_KEY,
      testMode: true,
      fetchImpl: async () => {
        called += 1;
        throw new Error("fetch must not run");
      },
    });
    assert.equal(called, 0);
    assert.equal(direct.ok, false);
    assert.equal(direct.error, SENTINEL_TEST_URL_REQUIRED);
  });

  it("sends the protection header only to the configured origin", async () => {
    const protection = {
      name: "x-deployment-protection",
      value: "test-bypass-not-a-secret",
      origin: "https://deploy.example",
    };
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), headers: { ...init.headers }, redirect: init.redirect });
      return new Response(JSON.stringify(sentinelBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await callSentinelDecision(INPUT, {
      apiKey: FIX_KEY,
      url: "https://deploy.example/sentinel/verify",
      deploymentProtection: protection,
      fetchImpl,
    });
    await callSentinelDecision(INPUT, {
      apiKey: FIX_KEY,
      url: "https://other.example/sentinel/verify",
      deploymentProtection: protection,
      fetchImpl,
    });
    await callSentinelDecision(INPUT, {
      apiKey: FIX_KEY,
      url: "https://deploy.example.evil/sentinel/verify",
      deploymentProtection: protection,
      fetchImpl,
    });

    assert.equal(seen.length, 3);
    assert.equal(seen[0].headers["x-deployment-protection"], protection.value);
    assert.equal(seen[0].redirect, "manual");
    assert.equal(seen[1].headers["x-deployment-protection"], undefined);
    assert.equal(seen[2].headers["x-deployment-protection"], undefined);
    for (const call of seen) {
      assert.equal(call.redirect, "manual");
    }
  });

  it("fails closed on redirect and does not forward the protection header", async () => {
    const seen = [];
    const env = await verifyDecision(INPUT, {
      sentinelApiKey: FIX_KEY,
      sentinelUrl: "https://deploy.example/sentinel/verify",
      deploymentProtection: {
        name: "x-deployment-protection",
        value: "test-bypass-not-a-secret",
        origin: "https://deploy.example",
      },
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), headers: { ...init.headers }, redirect: init.redirect });
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/collect" },
        });
      },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].redirect, "manual");
    assert.equal(seen[0].url, "https://deploy.example/sentinel/verify");
    assert.equal(seen[0].headers["x-deployment-protection"], "test-bypass-not-a-secret");
    assert.equal(env.execute, false);
    assert.match(env.objections.join(" "), /redirect refused/);
    assert.equal(env.objections.join(" ").includes("evil.example"), false);
    assert.equal(env.objections.join(" ").includes("test-bypass-not-a-secret"), false);
  });

  it("default mode uses the injected transport and does not call global fetch", async () => {
    const attemptsBefore = globalThis.__THOUGHTPROOF_OFFLINE_FETCH_ATTEMPTS?.length ?? 0;
    let requested = "";
    const result = await callSentinelDecision(INPUT, {
      apiKey: FIX_KEY,
      fetchImpl: async (url, init) => {
        requested = String(url);
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers["x-deployment-protection"], undefined);
        return new Response(JSON.stringify(sentinelBody()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(result.ok, true);
    assert.equal(requested, SENTINEL_VERIFY_URL);
    const attemptsAfter = globalThis.__THOUGHTPROOF_OFFLINE_FETCH_ATTEMPTS?.length ?? 0;
    assert.equal(attemptsAfter, attemptsBefore);
  });

  it("rejects an unusable protection header before fetch", async () => {
    const target = resolveSentinelTarget({
      SENTINEL_URL: "https://deploy.example/sentinel/verify",
      SENTINEL_DEPLOYMENT_PROTECTION_HEADER: "bad\nname",
      SENTINEL_DEPLOYMENT_PROTECTION: "test-bypass-not-a-secret",
    });
    assert.ok(target.protectionError);
    assert.equal(target.protection, undefined);
    assert.equal(JSON.stringify(target).includes("test-bypass-not-a-secret"), false);

    let called = 0;
    const env = await verifyDecision(INPUT, {
      sentinelApiKey: FIX_KEY,
      sentinelUrl: target.url,
      sentinelTargetError: target.protectionError,
      fetchImpl: async () => {
        called += 1;
        throw new Error("fetch must not run");
      },
    });
    assert.equal(called, 0);
    assert.equal(env.execute, false);
    assert.equal(env.structured_objections[0].code, "SENTINEL_TARGET_REJECTED");
    assert.equal(env.objections.join(" ").includes("test-bypass-not-a-secret"), false);
  });

  it("resolves test mode from env without embedding a production URL", () => {
    const missing = resolveSentinelTarget({ SENTINEL_TEST_MODE: "1" });
    assert.equal(missing.testMode, true);
    assert.equal(missing.url, undefined);
    assert.equal(JSON.stringify(missing).includes("thoughtproof.ai"), false);

    const set = resolveSentinelTarget({
      SENTINEL_TEST_MODE: "1",
      SENTINEL_URL: "https://deploy.example/sentinel/verify",
      SENTINEL_DEPLOYMENT_PROTECTION_HEADER: "x-deployment-protection",
      SENTINEL_DEPLOYMENT_PROTECTION: "test-bypass-not-a-secret",
    });
    assert.equal(set.url, "https://deploy.example/sentinel/verify");
    assert.equal(set.protection.origin, "https://deploy.example");
    assert.equal(set.protection.name, "x-deployment-protection");
  });
});
