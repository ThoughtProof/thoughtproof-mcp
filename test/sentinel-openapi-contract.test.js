/**
 * Contract: MCP outbound /sentinel/verify keys ⊆ live Sentinel OpenAPI
 * request properties. Does not call POST /sentinel/verify and does not
 * invent a top-level `quote`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSentinelVerifyBody,
  parseSentinelVerifyOpenApiBody,
  SENTINEL_OPENAPI_URL,
  SENTINEL_OPENAPI_VERIFY_BODY_FIELDS,
  SENTINEL_VERIFY_BODY_FIELDS,
} from "../dist/sentinel-decision-client.js";

const SAMPLE = {
  mandate: "Ship the release to production only after CI is green.",
  proposed_action: "Deploy the API to production",
  reasoning: "CI is green; send-to-prod now",
};

describe("Sentinel OpenAPI contract", () => {
  it("parses a fixture spec into documented body fields", () => {
    const parsed = parseSentinelVerifyOpenApiBody({
      paths: {
        "/sentinel/verify": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    required: ["claim", "evidence", "mode"],
                    properties: {
                      claim: {},
                      evidence: {},
                      mode: {},
                      tier: {},
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    assert.deepEqual(parsed.required, ["claim", "evidence", "mode"]);
    assert.deepEqual(parsed.properties, ["claim", "evidence", "mode", "tier"]);
  });

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

    assert.deepEqual(
      properties,
      pinned,
      "SENTINEL_OPENAPI_VERIFY_BODY_FIELDS drifted from live OpenAPI — regenerate the pin",
    );
    assert.equal(documented.has("quote"), false, "OpenAPI request must not document top-level quote");

    const body = buildSentinelVerifyBody(SAMPLE);
    const outbound = Object.keys(body).sort();
    assert.equal(Object.hasOwn(body, "quote"), false);
    for (const key of outbound) {
      assert.ok(
        documented.has(key),
        `outbound field "${key}" is not in live OpenAPI POST /sentinel/verify properties`,
      );
      assert.ok(
        SENTINEL_VERIFY_BODY_FIELDS.includes(key),
        `outbound field "${key}" is not in SENTINEL_VERIFY_BODY_FIELDS`,
      );
    }
    for (const field of required) {
      assert.ok(
        Object.hasOwn(body, field),
        `outbound body missing OpenAPI-required field "${field}"`,
      );
    }
  });
});
