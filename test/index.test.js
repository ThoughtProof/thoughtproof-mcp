import { describe, it, before, after } from "node:test";
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

  after(async () => {
    await client?.close();
  });

  it("should expose verify_decision as the hero tool plus existing tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("verify_decision"), "missing verify_decision");
    assert.ok(names.includes("verify_claim"), "missing verify_claim");
    assert.ok(names.includes("check_agent_score"), "missing check_agent_score");
  });

  it("verify_decision tool has correct input schema", async () => {
    const { tools } = await client.listTools();
    const decision = tools.find((t) => t.name === "verify_decision");
    assert.ok(decision.inputSchema, "missing input schema");
    const props = decision.inputSchema.properties;
    assert.ok(props.mandate, "missing mandate property");
    assert.ok(props.proposed_action, "missing proposed_action property");
    assert.ok(props.reasoning, "missing reasoning property");
    assert.ok(props.context, "missing context property");
    assert.ok(props.mode, "missing mode property");
    assert.ok(
      /must NOT put the overshoot/i.test(decision.description ?? ""),
      "tool description must carry the camera mandate"
    );
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

  it("verify_decision returns execute:false when no DQL key is configured", async () => {
    const result = await client.callTool({
      name: "verify_decision",
      arguments: {
        mandate: "Buy milk under $5",
        proposed_action: "Purchase milk for $4",
        reasoning: "It is under the budget",
      },
    });
    assert.ok(result.content?.[0]?.text, "should return text");
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.execute, false);
    assert.notEqual(envelope.verdict, "ALLOW");
    assert.equal(envelope.surface, "dql");
    assert.match(envelope.objections.join(" "), /DQL key not configured/);
  });

  it("verify_claim handles API errors gracefully", { timeout: 20_000 }, async () => {
    // Call with a claim — will likely get 402 or error since no real key
    // The important thing is it doesn't crash. Bounded so CI does not hang
    // on a live RV fetch.
    const result = await client.callTool({
      name: "verify_claim",
      arguments: { claim: "Test claim for CI" },
    });
    assert.ok(result.content, "should return content");
    assert.ok(result.content.length > 0, "should have at least one content block");
    assert.equal(result.content[0].type, "text", "should return text content");
  });
});
