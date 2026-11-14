/**
 * OPT-IN live check. Not loaded by `npm test` or PR CI.
 * Run with `npm run test:live` only when a human wants a live OpenAPI diff.
 * This file fetches https://sentinel.thoughtproof.ai/openapi.json. It does
 * not POST /sentinel/verify.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActionAuthorizationClaim,
  buildSentinelVerifyBody,
  parseSentinelVerifyOpenApiBody,
  SENTINEL_OPENAPI_URL,
  SENTINEL_OPENAPI_VERIFY_BODY_FIELDS,
  SENTINEL_VERIFY_BODY_FIELDS,
} from "../../dist/sentinel-decision-client.js";

const SAMPLE = {
  mandate: "Ship the release to production only after CI is green.",
  proposed_action: "Deploy the API to production",
  reasoning: "CI is green; send-to-prod now",
};

const EXACT_PIN = process.env.OPENAPI_EXACT_PIN === "1";

describe("Sentinel OpenAPI contract (live, opt-in)", () => {
  it("outbound body fields are a subset of live OpenAPI properties", async () => {
    const res = await fetch(SENTINEL_OPENAPI_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok(res.ok, `live OpenAPI fetch failed: HTTP ${res.status}`);
    const spec = await res.json();
    const { properties, required } = parseSentinelVerifyOpenApiBody(spec);
    const documented = new Set(properties);
    const pinned = [...SENTINEL_OPENAPI_VERIFY_BODY_FIELDS].sort();

    for (const field of pinned) {
      assert.ok(
        documented.has(field),
        `pinned SENTINEL_OPENAPI_VERIFY_BODY_FIELDS entry "${field}" missing from live OpenAPI`,
      );
    }
    if (EXACT_PIN) {
      assert.deepEqual(
        properties,
        pinned,
        "OPENAPI_EXACT_PIN=1: SENTINEL_OPENAPI_VERIFY_BODY_FIELDS drifted from live OpenAPI — regenerate the pin",
      );
    }
    assert.equal(documented.has("quote"), false);

    const body = buildSentinelVerifyBody(SAMPLE);
    assert.equal(body.claim, buildActionAuthorizationClaim(SAMPLE.proposed_action));
    for (const key of Object.keys(body)) {
      assert.ok(documented.has(key), key);
      assert.ok(SENTINEL_VERIFY_BODY_FIELDS.includes(key), key);
    }
    for (const field of required) {
      assert.equal(Object.hasOwn(body, field), true, field);
    }
  });
});
