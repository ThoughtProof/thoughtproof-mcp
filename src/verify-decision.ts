/**
 * verify_decision — hero MCP tool.
 *
 * Routes inside the tool (heuristic, no LLM) to DQL or Sentinel.
 * Does not call RV/PLV. Does not escalate verify_trade. Soft fail-closed:
 * execute is true ONLY on native ALLOW; the host is not hard-stopped.
 */

import { callDql, type DqlAxisResult, type DqlResponse } from "./dql-client.js";
import {
  callSentinelDecision,
  type SentinelResponse,
} from "./sentinel-decision-client.js";
import { routeDecision, type DecisionMode, type DecisionSurface } from "./route-decision.js";

export interface VerifyDecisionInput {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
  mode?: DecisionMode;
}

export interface DecisionAxis {
  axis: string;
  verdict: string;
  objection: string;
}

export interface DecisionEnvelope {
  verdict: string;
  execute: boolean;
  objections: string[];
  receipt_id: string;
  surface: DecisionSurface;
  axes?: DecisionAxis[];
  recommendation: string;
}

export interface VerifyDecisionConfig {
  dqlApiKey?: string;
  sentinelApiKey?: string;
  dqlUrl?: string;
  sentinelUrl?: string;
  timeoutMs?: number;
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
}

export function executeAllowed(verdict: string): boolean {
  return String(verdict ?? "").toUpperCase() === "ALLOW";
}

export function recommend(verdict: string, objections: string[]): string {
  if (executeAllowed(verdict)) return "execute";
  if (objections.length > 0) return "do not execute — replan from objections";
  return "do not execute";
}

export function errorEnvelope(
  surface: DecisionSurface,
  message: string,
  receipt_id = "",
): DecisionEnvelope {
  return {
    verdict: "ERROR",
    execute: false,
    objections: [message],
    receipt_id,
    surface,
    recommendation: `do not execute — ${message}`,
  };
}

export function mapDqlEnvelope(body: DqlResponse): DecisionEnvelope {
  const verdict = String(body.aggregate?.verdict ?? "ERROR");
  const axes: DecisionAxis[] = Array.isArray(body.axes)
    ? body.axes.map((a: DqlAxisResult) => ({
        axis: String(a.axis ?? ""),
        verdict: String(a.verdict ?? ""),
        objection: String(a.objection ?? ""),
      }))
    : [];

  const objections: string[] = [];
  for (const axis of axes) {
    if (axis.objection.trim()) objections.push(axis.objection);
  }
  const rationale = body.aggregate?.rationale?.trim();
  if (rationale) objections.push(rationale);

  return {
    verdict,
    execute: executeAllowed(verdict),
    objections,
    receipt_id: String(body.id ?? ""),
    surface: "dql",
    axes,
    recommendation: recommend(verdict, objections),
  };
}

export function mapSentinelEnvelope(body: SentinelResponse): DecisionEnvelope {
  const verdict = String(body.verdict ?? "ERROR");
  const objections: string[] = [];

  if (Array.isArray(body.objections)) {
    for (const obj of body.objections) {
      const text = String(obj.reasoning ?? obj.quote ?? "").trim();
      if (text) objections.push(text);
    }
  }
  const reason = String(body.reasoning ?? "").trim();
  if (reason && !objections.includes(reason)) objections.push(reason);

  return {
    verdict,
    execute: executeAllowed(verdict),
    objections,
    receipt_id: String(body.id ?? ""),
    surface: "sentinel",
    recommendation: recommend(verdict, objections),
  };
}

export async function verifyDecision(
  input: VerifyDecisionInput,
  cfg: VerifyDecisionConfig = {},
): Promise<DecisionEnvelope> {
  const surface = routeDecision(input);

  try {
    if (surface === "dql") {
      const apiKey = cfg.dqlApiKey?.trim();
      if (!apiKey) {
        return errorEnvelope(
          "dql",
          "DQL key not configured (set DQL_API_KEY or THOUGHTPROOF_DQL_KEY)",
        );
      }
      const result = await callDql(input, {
        apiKey,
        url: cfg.dqlUrl,
        timeoutMs: cfg.timeoutMs,
        sandbox: cfg.sandbox === true,
        fetchImpl: cfg.fetchImpl,
      });
      if (!result.ok) return errorEnvelope("dql", result.error);
      return mapDqlEnvelope(result.body);
    }

    const apiKey = cfg.sentinelApiKey?.trim();
    if (!apiKey) {
      return errorEnvelope("sentinel", "Sentinel key not configured");
    }
    const result = await callSentinelDecision(input, {
      apiKey,
      url: cfg.sentinelUrl,
      timeoutMs: cfg.timeoutMs,
      fetchImpl: cfg.fetchImpl,
    });
    if (!result.ok) return errorEnvelope("sentinel", result.error);
    return mapSentinelEnvelope(result.body);
  } catch (err) {
    return errorEnvelope(surface, String(err));
  }
}
