/**
 * verify_decision — hero MCP tool.
 *
 * Routes inside the tool (heuristic, no LLM) to DQL or Sentinel.
 * Does not call RV/PLV. Does not escalate verify_trade. Soft fail-closed:
 * execute is true ONLY on native ALLOW; the host is not hard-stopped.
 *
 * Structured objections + repair loop are envelope fields on this unpublished
 * tree. They do not invent DQL/Sentinel API schemas. Host must still honor
 * execute=false. Passing in_reply_to is a new verify call (new receipt).
 */

import {
  callDql,
  resolveDqlCredential,
  type DqlAuth,
  type DqlAxisResult,
  type DqlResponse,
} from "./dql-client.js";
import {
  callSentinelDecision,
  isBlankMandate,
  type SentinelObjection,
  type SentinelResponse,
} from "./sentinel-decision-client.js";
import { routeDecision, type DecisionMode, type DecisionSurface } from "./route-decision.js";

export type ObjectionSeverity = "block" | "blocked_until";
export type RepairHint = "FRESH_EVIDENCE" | "REVISE_CLAIM" | "SUPERSEDE_MANDATE" | "NONE";
export type LoopState = "idle" | "challenged" | "repairing" | "covered";

export interface VerifyDecisionInput {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
  /**
   * Optional verbatim excerpt of the user mandate for Sentinel provenance.
   * Ignored on the DQL path. Used only when it is a substring of mandate and
   * at least 20 characters; otherwise the full mandate is quoted into evidence.
   */
  quote?: string;
  mode?: DecisionMode;
  /** Open objection_id from a prior envelope. New call = new receipt. */
  in_reply_to?: string;
}

export interface DecisionAxis {
  axis: string;
  verdict: string;
  objection: string;
}

export interface StructuredObjection {
  objection_id: string;
  code: string;
  severity: ObjectionSeverity;
  claim: string;
  message: string;
  repair_hints: RepairHint[];
  axis_or_surface: string;
  human_required: boolean;
}

export interface DecisionEnvelope {
  verdict: string;
  execute: boolean;
  objections: string[];
  receipt_id: string;
  surface: DecisionSurface;
  axes?: DecisionAxis[];
  recommendation: string;
  structured_objections: StructuredObjection[];
  loop: LoopState;
  in_reply_to?: string;
}

export interface VerifyDecisionConfig {
  dqlApiKey?: string;
  dqlAccountToken?: string;
  dqlAuth?: DqlAuth;
  sentinelApiKey?: string;
  dqlUrl?: string;
  sentinelUrl?: string;
  timeoutMs?: number;
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
}

const REPAIR_PREFIX = "[ThoughtProof repair]";

export function resolveVerifyDqlAuth(cfg: VerifyDecisionConfig): DqlAuth | undefined {
  if (cfg.dqlAuth) return cfg.dqlAuth;
  return resolveDqlCredential({
    DQL_API_KEY: cfg.dqlApiKey,
    DQL_ACCOUNT_TOKEN: cfg.dqlAccountToken,
  });
}

export function executeAllowed(verdict: string): boolean {
  return String(verdict ?? "").toUpperCase() === "ALLOW";
}

export function objectionId(receiptId: string, slot: string | number): string {
  const rec = String(receiptId || "noreceipt").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const sl = String(slot).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `o_${rec}_${sl}`;
}

export function axisCode(axis: string): string {
  const a = String(axis || "axis").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return a || "AXIS";
}

function loopState(execute: boolean, inReplyTo?: string): LoopState {
  if (execute) return "covered";
  if (inReplyTo && inReplyTo.trim()) return "repairing";
  return "challenged";
}

export function recommend(
  verdict: string,
  objections: string[],
  structured: StructuredObjection[] = [],
): string {
  if (executeAllowed(verdict)) return "execute";
  const until = structured.find((o) => o.severity === "blocked_until");
  if (until) {
    return `do not execute — repair structured_objections (next call: in_reply_to=${until.objection_id})`;
  }
  if (objections.length > 0) return "do not execute — replan from objections";
  return "do not execute";
}

export function applyRepairContext(input: VerifyDecisionInput): VerifyDecisionInput {
  const id = input.in_reply_to?.trim();
  if (!id) return input;
  const note =
    `${REPAIR_PREFIX} in_reply_to=${id}. Treat this call as a repair of that objection. ` +
    `New evidence/claim is in proposed_action/reasoning/context. Prior ALLOW receipts do not carry.`;
  const context = input.context?.trim() ? `${note}\n\n${input.context}` : note;
  return { ...input, context };
}

function attachLoop(
  env: Omit<DecisionEnvelope, "loop" | "in_reply_to" | "structured_objections"> & {
    structured_objections?: StructuredObjection[];
  },
  inReplyTo?: string,
): DecisionEnvelope {
  const structured = env.structured_objections ?? [];
  const in_reply_to = inReplyTo?.trim() || undefined;
  return {
    ...env,
    structured_objections: structured,
    loop: loopState(env.execute, in_reply_to),
    ...(in_reply_to ? { in_reply_to } : {}),
    recommendation: recommend(env.verdict, env.objections, structured),
  };
}

export function errorEnvelope(
  surface: DecisionSurface,
  message: string,
  receipt_id = "",
  inReplyTo?: string,
  code = "GATE_ERROR",
): DecisionEnvelope {
  const structured: StructuredObjection[] = [
    {
      objection_id: objectionId(receipt_id || "error", "gate"),
      code,
      severity: "block",
      claim: "verify_decision",
      message,
      repair_hints: ["NONE"],
      axis_or_surface: surface,
      human_required: true,
    },
  ];
  return attachLoop(
    {
      verdict: "ERROR",
      execute: false,
      objections: [message],
      receipt_id,
      surface,
      recommendation: `do not execute — ${message}`,
      structured_objections: structured,
    },
    inReplyTo,
  );
}

export function mapDqlEnvelope(body: DqlResponse, inReplyTo?: string): DecisionEnvelope {
  const verdict = String(body.aggregate?.verdict ?? "ERROR");
  const receipt_id = String(body.id ?? "");
  const axes: DecisionAxis[] = Array.isArray(body.axes)
    ? body.axes.map((a: DqlAxisResult) => ({
        axis: String(a.axis ?? ""),
        verdict: String(a.verdict ?? ""),
        objection: String(a.objection ?? ""),
      }))
    : [];

  const objections: string[] = [];
  const structured: StructuredObjection[] = [];
  let i = 0;
  for (const axis of axes) {
    if (axis.objection.trim()) objections.push(axis.objection);
    const axisPass = axis.verdict.toUpperCase() === "PASS" || axis.verdict.toUpperCase() === "ALLOW";
    if (!axisPass && (axis.objection.trim() || axis.verdict)) {
      structured.push({
        objection_id: objectionId(receipt_id, axis.axis || i),
        code: axisCode(axis.axis || "AXIS"),
        severity: "blocked_until",
        claim: axis.axis || "axis",
        message: axis.objection.trim() || `Axis ${axis.axis} verdict ${axis.verdict}`,
        repair_hints: ["REVISE_CLAIM", "FRESH_EVIDENCE"],
        axis_or_surface: axis.axis || "dql",
        human_required: false,
      });
    }
    i += 1;
  }
  const rationale = body.aggregate?.rationale?.trim();
  if (rationale) objections.push(rationale);
  if (!executeAllowed(verdict) && structured.length === 0 && rationale) {
    structured.push({
      objection_id: objectionId(receipt_id, "aggregate"),
      code: "AGGREGATE",
      severity: "blocked_until",
      claim: "aggregate",
      message: rationale,
      repair_hints: ["REVISE_CLAIM", "FRESH_EVIDENCE"],
      axis_or_surface: "dql",
      human_required: false,
    });
  }

  return attachLoop(
    {
      verdict,
      execute: executeAllowed(verdict),
      objections,
      receipt_id,
      surface: "dql",
      axes,
      recommendation: recommend(verdict, objections, structured),
      structured_objections: executeAllowed(verdict) ? [] : structured,
    },
    inReplyTo,
  );
}

export function mapSentinelEnvelope(body: SentinelResponse, inReplyTo?: string): DecisionEnvelope {
  const verdict = String(body.verdict ?? "ERROR");
  const receipt_id = String(body.id ?? "");
  const objections: string[] = [];
  const structured: StructuredObjection[] = [];

  if (Array.isArray(body.objections)) {
    body.objections.forEach((obj: SentinelObjection, idx: number) => {
      const text = String(obj.reasoning ?? obj.quote ?? "").trim();
      if (text) objections.push(text);
      const slot = obj.criterion || obj.step_id || idx;
      if (text || obj.criterion) {
        structured.push({
          objection_id: objectionId(receipt_id, slot),
          code: axisCode(String(obj.criterion || "EVIDENCE")),
          severity: "blocked_until",
          claim: String(obj.criterion || obj.predicate || "action"),
          message: text || String(obj.predicate || "unsupported"),
          repair_hints: ["FRESH_EVIDENCE", "REVISE_CLAIM"],
          axis_or_surface: String(obj.criterion || "sentinel"),
          human_required: false,
        });
      }
    });
  }
  const reason = String(body.reasoning ?? "").trim();
  if (reason && !objections.includes(reason)) objections.push(reason);
  if (!executeAllowed(verdict) && structured.length === 0 && reason) {
    structured.push({
      objection_id: objectionId(receipt_id, "reasoning"),
      code: "SENTINEL",
      severity: "blocked_until",
      claim: "proposed_action",
      message: reason,
      repair_hints: ["FRESH_EVIDENCE", "REVISE_CLAIM"],
      axis_or_surface: "sentinel",
      human_required: false,
    });
  }

  return attachLoop(
    {
      verdict,
      execute: executeAllowed(verdict),
      objections,
      receipt_id,
      surface: "sentinel",
      recommendation: recommend(verdict, objections, structured),
      structured_objections: executeAllowed(verdict) ? [] : structured,
    },
    inReplyTo,
  );
}

export async function verifyDecision(
  input: VerifyDecisionInput,
  cfg: VerifyDecisionConfig = {},
): Promise<DecisionEnvelope> {
  const inReplyTo = input.in_reply_to?.trim();
  const repaired = applyRepairContext(input);
  const surface = routeDecision(repaired);

  if (isBlankMandate(repaired.mandate)) {
    return errorEnvelope(
      surface,
      "mandate is required (empty or whitespace-only)",
      "",
      inReplyTo,
      "MANDATE_REQUIRED",
    );
  }

  try {
    if (surface === "dql") {
      const auth = resolveVerifyDqlAuth(cfg);
      if (!auth) {
        return errorEnvelope(
          "dql",
          "DQL key not configured (set DQL_API_KEY, THOUGHTPROOF_DQL_KEY, or DQL_ACCOUNT_TOKEN)",
          "",
          inReplyTo,
        );
      }
      const result = await callDql(repaired, {
        auth,
        url: cfg.dqlUrl,
        timeoutMs: cfg.timeoutMs,
        sandbox: cfg.sandbox === true,
        fetchImpl: cfg.fetchImpl,
      });
      if (!result.ok) return errorEnvelope("dql", result.error, "", inReplyTo);
      return mapDqlEnvelope(result.body, inReplyTo);
    }

    const apiKey = cfg.sentinelApiKey?.trim();
    if (!apiKey) {
      return errorEnvelope("sentinel", "Sentinel key not configured", "", inReplyTo);
    }
    const result = await callSentinelDecision(repaired, {
      apiKey,
      url: cfg.sentinelUrl,
      timeoutMs: cfg.timeoutMs,
      fetchImpl: cfg.fetchImpl,
    });
    if (!result.ok) return errorEnvelope("sentinel", result.error, "", inReplyTo);
    return mapSentinelEnvelope(result.body, inReplyTo);
  } catch (err) {
    return errorEnvelope(surface, String(err), "", inReplyTo);
  }
}
