/**
 * Offline contract: outbound /sentinel/verify keys stay inside the pinned
 * body field list. Does not fetch OpenAPI and does not POST /sentinel/verify.
 *
 * The live comparison against https://sentinel.thoughtproof.ai/openapi.json
 * is test/live/sentinel-openapi-contract.live.test.js (`npm run test:live`).
 * That script is not part of `npm test` or PR CI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActionAuthorizationClaim,
  buildSentinelVerifyBody,
  parseSentinelVerifyOpenApiBody,
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

  it("outbound body fields stay inside the pinned allowlist", () => {
    const pinned = new Set(SENTINEL_VERIFY_BODY_FIELDS);
    for (const field of SENTINEL_OPENAPI_VERIFY_BODY_FIELDS) {
      assert.equal(pinned.has(field), true, field);
    }
    assert.equal(pinned.has("quote"), false);

    const body = buildSentinelVerifyBody(SAMPLE);
    assert.equal(Object.hasOwn(body, "quote"), false);
    assert.equal(body.claim, buildActionAuthorizationClaim(SAMPLE.proposed_action));
    assert.notEqual(body.claim, SAMPLE.proposed_action);
    for (const key of Object.keys(body)) {
      assert.equal(pinned.has(key), true, key);
    }
    for (const field of ["claim", "evidence", "mode"]) {
      assert.equal(Object.hasOwn(body, field), true, field);
    }

    const withKinds = buildSentinelVerifyBody({
      ...SAMPLE,
      mandate_kind: "local_command",
      action_kind: "local_command",
    });
    assert.equal(withKinds.mandate.kind, "local_command");
    assert.equal(withKinds.mandate.action.kind, "local_command");
    assert.doesNotMatch(withKinds.evidence, /Host-declared kinds:/);
    for (const key of Object.keys(withKinds)) {
      assert.equal(pinned.has(key), true, key);
    }
  });
});
