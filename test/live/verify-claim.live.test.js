/**
 * OPT-IN live check. Not loaded by `npm test` or PR CI.
 * Run with `npm run test:live`. This starts the server and calls verify_claim,
 * which reaches the production RV API.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("verify_claim live", () => {
  let client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
    });
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
  });

  it("handles API errors gracefully", { timeout: 20_000 }, async () => {
    const result = await client.callTool({
      name: "verify_claim",
      arguments: { claim: "Test claim for a manual live run" },
    });
    assert.ok(result.content, "should return content");
    assert.ok(result.content.length > 0, "should have at least one content block");
    assert.equal(result.content[0].type, "text", "should return text content");
  });
});
