// Smoke test: spawn the built MCP server over stdio, do the initialize handshake,
// list tools, and assert verify_trade is exposed with the right schema.
// No network calls — this validates the MCP wiring only.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../dist/index.js");

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

const child = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let buf = "";
const responses = [];
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try {
        responses.push(JSON.parse(line));
      } catch {
        /* ignore non-json */
      }
    }
  }
});

function waitFor(id, timeoutMs = 5000) {
  return new Promise((res, rej) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const found = responses.find((r) => r.id === id);
      if (found) {
        clearInterval(iv);
        res(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        rej(new Error(`timeout waiting for response id=${id}`));
      }
    }, 50);
  });
}

async function run() {
  // 1. initialize
  child.stdin.write(
    rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    }),
  );
  const init = await waitFor(1);
  if (!init.result?.serverInfo?.name) throw new Error("initialize failed");
  console.log("✓ initialize:", init.result.serverInfo.name, init.result.serverInfo.version);

  // notifications/initialized
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // 2. tools/list
  child.stdin.write(rpc(2, "tools/list", {}));
  const list = await waitFor(2);
  const tools = list.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  console.log("✓ tools/list: found", names.join(", "));

  const vd = tools.find((t) => t.name === "verify_decision");
  if (!vd) throw new Error("verify_decision tool not found");
  console.log("✓ verify_decision present");

  const vdReq = vd.inputSchema?.required ?? [];
  for (const f of ["mandate", "proposed_action", "reasoning"]) {
    if (!vdReq.includes(f)) throw new Error(`verify_decision missing required field: ${f}`);
  }
  console.log("✓ verify_decision schema:", vdReq.join(", "));

  const vt = tools.find((t) => t.name === "verify_trade");
  if (!vt) throw new Error("verify_trade tool not found");
  console.log("✓ verify_trade present");

  const req = vt.inputSchema?.required ?? [];
  for (const f of ["action", "thesis", "reasoning"]) {
    if (!req.includes(f)) throw new Error(`verify_trade missing required field: ${f}`);
  }
  console.log("✓ schema: required fields present:", req.join(", "));

  // sanity: the original tools survived the integration
  for (const t of ["verify_claim", "check_agent_score"]) {
    if (!names.includes(t)) throw new Error(`regression: ${t} tool disappeared`);
  }
  console.log("✓ existing tools intact (verify_claim, check_agent_score)");

  console.log("\nALL MCP WIRING CHECKS PASSED");
  child.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  child.kill();
  process.exit(1);
});
