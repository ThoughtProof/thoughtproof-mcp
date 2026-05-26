import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("thoughtproof-mcp server", () => {
  let client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
    });
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  it("should expose verify_claim and check_agent_score tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("verify_claim"), "missing verify_claim");
    assert.ok(names.includes("check_agent_score"), "missing check_agent_score");
    assert.equal(tools.length, 2, "expected exactly 2 tools");
  });

  it("verify_claim tool has correct input schema", async () => {
    const { tools } = await client.listTools();
    const verify = tools.find((t) => t.name === "verify_claim");
    assert.ok(verify.inputSchema, "missing input schema");
    const props = verify.inputSchema.properties;
    assert.ok(props.claim, "missing claim property");
    assert.ok(props.stakeLevel, "missing stakeLevel property");
    assert.ok(props.domain, "missing domain property");
    assert.ok(props.speed, "missing speed property");
  });

  it("check_agent_score tool has correct input schema", async () => {
    const { tools } = await client.listTools();
    const score = tools.find((t) => t.name === "check_agent_score");
    assert.ok(score.inputSchema, "missing input schema");
    const props = score.inputSchema.properties;
    assert.ok(props.agentId, "missing agentId property");
    assert.ok(props.domain, "missing domain property");
  });

  it("verify_claim handles API errors gracefully", async () => {
    // Call with a claim — will likely get 402 or error since no real key
    // The important thing is it doesn't crash
    const result = await client.callTool({
      name: "verify_claim",
      arguments: { claim: "Test claim for CI" },
    });
    assert.ok(result.content, "should return content");
    assert.ok(result.content.length > 0, "should have at least one content block");
    assert.equal(result.content[0].type, "text", "should return text content");
  });
});
