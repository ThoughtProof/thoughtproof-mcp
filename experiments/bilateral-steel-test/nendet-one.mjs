#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDecision } from "../../dist/verify-decision.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pkt = JSON.parse(readFileSync(process.argv[2], "utf8"));
const kf = process.env.KEY_FILE;
if (!kf) {
  console.error("NO_KEY_FILE");
  process.exit(2);
}
const key = readFileSync(kf, "utf8").trim();
if (key.startsWith("dqla_")) {
  console.error("WRONG_PATH");
  process.exit(2);
}
const env = await verifyDecision(
  {
    mandate: pkt.mandate,
    proposed_action: pkt.proposed_action,
    reasoning: pkt.reasoning,
    context: pkt.context,
    mode: "dql",
    in_reply_to: pkt.in_reply_to,
  },
  { dqlApiKey: key },
);
const slim = {
  verdict: env.verdict,
  execute: env.execute,
  loop: env.loop,
  receipt_id: env.receipt_id,
  in_reply_to: env.in_reply_to,
  recommendation: env.recommendation,
  objections: (env.objections || []).slice(0, 4),
  structured_objections: (env.structured_objections || []).slice(0, 6).map((o) => ({
    objection_id: o.objection_id,
    code: o.code,
    severity: o.severity,
    message: (o.message || "").slice(0, 240),
  })),
};
process.stdout.write(JSON.stringify(slim));
