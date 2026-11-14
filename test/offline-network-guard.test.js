/**
 * Proof that the default suite cannot open a socket through global fetch.
 * npm test loads test/offline-fetch-guard.js before any test file.
 */
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("offline network guard", () => {
  it("fails closed on global fetch and is what npm test and PR CI run", async () => {
    await assert.rejects(
      () => fetch("https://sentinel.thoughtproof.ai/openapi.json"),
      /offline guard: unexpected network fetch/,
    );
    assert.equal(globalThis.__THOUGHTPROOF_OFFLINE_FETCH_GUARD, true);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.match(pkg.scripts.test, /--import \.\/test\/offline-fetch-guard\.js/);
    assert.match(pkg.scripts.test, /test\/\*\.test\.js/);
    assert.doesNotMatch(pkg.scripts.test, /test:live/);
    assert.equal(pkg.scripts["test:live"], "node --test test/live/*.test.js");

    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    assert.match(ci, /npm test/);
    assert.equal(ci.includes("test:live"), false);
    assert.equal(ci.includes("sentinel.thoughtproof.ai"), false);
  });
});
