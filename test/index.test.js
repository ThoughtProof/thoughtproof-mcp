import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const GUARD = fileURLToPath(new URL("./offline-fetch-guard.js", import.meta.url));

function serverEnv(extra = {}) {
  const env = { ...process.env };
  const flag = `--import ${GUARD}`;
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${flag}` : flag;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe("thoughtproof-mcp server", () => {
  let client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: serverEnv(),
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
    assert.ok(names.includes("verify_before_action"), "missing verify_before_action alias");
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
    assert.ok(props.quote, "missing quote property");
    assert.ok(props.mandate_kind, "missing mandate_kind property");
    assert.ok(props.action_kind, "missing action_kind property");
    assert.deepEqual(props.mandate_kind.enum, [
      "informational",
      "value_transfer",
      "permission",
      "deploy_ship",
      "local_command",
      "unknown",
    ]);
    assert.deepEqual(props.action_kind.enum, props.mandate_kind.enum);
    assert.match(decision.description ?? "", /local_command/);
    assert.match(props.mandate_kind.description ?? "", /local_command/);
    assert.match(props.action_kind.description ?? "", /local_command/);
    assert.match(props.mode.description ?? "", /command-form/);
    const alias = tools.find((t) => t.name === "verify_before_action");
    assert.deepEqual(alias.inputSchema.properties.action_kind.enum, props.action_kind.enum);
    assert.equal(alias.description, decision.description);
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

});

describe("tool handler test mode", () => {
  let client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: serverEnv({
        SENTINEL_TEST_MODE: "1",
        SENTINEL_URL: undefined,
        SENTINEL_API_KEY: "sentinel_test_mode_only",
        THOUGHTPROOF_API_KEY: undefined,
      }),
    });
    client = new Client({ name: "test-mode-client", version: "1.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
  });

  it("aborts before fetch when SENTINEL_TEST_MODE has no SENTINEL_URL", async () => {
    const result = await client.callTool({
      name: "verify_before_action",
      arguments: {
        mandate: "Inspect the repo.",
        proposed_action: "run_command: git status",
        reasoning: "Read-only status.",
        mode: "sentinel",
      },
    });
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.execute, false);
    assert.equal(envelope.surface, "sentinel");
    assert.equal(envelope.structured_objections[0].code, "SENTINEL_URL_REQUIRED");
    assert.match(envelope.objections.join(" "), /SENTINEL_TEST_MODE requires SENTINEL_URL/);
    assert.equal(envelope.objections.join(" ").includes("offline guard"), false);
    assert.equal(envelope.objections.join(" ").includes("sentinel_test_mode_only"), false);
  });
});
