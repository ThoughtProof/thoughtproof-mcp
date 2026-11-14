/**
 * Shared request-binding v2 vectors.
 * Exercised against both request builders. A future Sentinel implementation
 * can hash these same bodies. Not production evidence.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  REQUEST_BINDING_PROFILE,
  RequestBindingRejected,
  canonicalRequestBinding,
  computeRequestHash,
  jcs,
} from "../dist/request-binding.js";
import { buildSentinelVerifyBody } from "../dist/sentinel-decision-client.js";
import { buildTradeVerifyBody } from "../dist/verify-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, "fixtures/request-binding-v2.json"), "utf8"));

function byId(id) {
  const vector = doc.vectors.find((item) => item.id === id);
  assert.ok(vector, id);
  return vector;
}

describe("request-binding v2 vectors", () => {
  it("pins profile, JCS, and sha256 for every committed vector", () => {
    assert.equal(doc.profile, REQUEST_BINDING_PROFILE);
    assert.equal(doc.profile, "thoughtproof.mcp.request_binding.v2");
    for (const vector of doc.vectors) {
      if (vector.reject) continue;
      assert.equal(vector.envelope.profile, REQUEST_BINDING_PROFILE);
      assert.deepEqual(vector.envelope.request, vector.body);
      assert.equal(jcs(vector.envelope), vector.jcs);
      assert.equal(canonicalRequestBinding(vector.body), vector.jcs);
      const digest = `sha256:${createHash("sha256").update(vector.jcs, "utf8").digest("hex")}`;
      assert.equal(digest, vector.requestHash);
      assert.equal(computeRequestHash(vector.body), vector.requestHash);
    }
  });

  it("matches the sentinel-decision builder, including Raul's identical-body pair", () => {
    for (const vector of doc.vectors.filter((item) => item.builder === "sentinel-decision" && item.input)) {
      const { tier, ...input } = vector.input;
      assert.deepEqual(buildSentinelVerifyBody(input, tier), vector.body);
      assert.equal(computeRequestHash(buildSentinelVerifyBody(input, tier)), vector.requestHash);
    }
    const pair = byId("raul-context-collapse");
    const built = pair.inputs.map((item) => {
      const { tier, ...input } = item;
      return buildSentinelVerifyBody(input, tier);
    });
    assert.deepEqual(built[0], built[1]);
    assert.deepEqual(built[0], pair.body);
    assert.equal(computeRequestHash(built[0]), computeRequestHash(built[1]));
    assert.equal(computeRequestHash(built[0]), pair.requestHash);
  });

  it("matches the verify_trade builder", () => {
    const vector = byId("trade-builder");
    const { tier, ...input } = vector.input;
    assert.deepEqual(buildTradeVerifyBody(input, tier), vector.body);
    assert.equal(computeRequestHash(buildTradeVerifyBody(input, tier)), vector.requestHash);
  });

  it("treats key order and indentation as the same hash and inside-string whitespace as different", () => {
    const decision = byId("decision-builder");
    assert.ok(decision.serializedVariants.length >= 2);
    for (const serialized of decision.serializedVariants) {
      assert.equal(computeRequestHash(JSON.parse(serialized)), decision.requestHash);
    }
    assert.notEqual(decision.serializedVariants[0], decision.serializedVariants[1]);

    const spaced = byId("inside-string-whitespace");
    assert.notEqual(spaced.requestHash, decision.requestHash);
    assert.notEqual(spaced.body.claim, decision.body.claim);
    assert.equal(spaced.body.claim.includes("git  status"), true);

    const extra = byId("unknown-extra-field");
    assert.equal(extra.body["x-extra"], "kept");
    assert.notEqual(extra.requestHash, decision.requestHash);

    const nulled = byId("null-mandate");
    assert.equal(nulled.body.mandate, null);
    assert.equal(Object.hasOwn(decision.body, "mandate"), false);
    assert.notEqual(nulled.requestHash, decision.requestHash);
  });

  it("rejects lone surrogates and still hashes a valid surrogate pair", () => {
    const rejected = doc.vectors.filter((item) => item.reject);
    assert.ok(rejected.length >= 3);
    for (const vector of rejected) {
      assert.throws(() => jcs(vector.body), RequestBindingRejected);
      assert.throws(() => computeRequestHash(vector.body), RequestBindingRejected);
    }
    const emoji = byId("valid-surrogate-pair");
    assert.equal(emoji.body.claim.includes("😀"), true);
    assert.equal(computeRequestHash(emoji.body), emoji.requestHash);
  });
});
