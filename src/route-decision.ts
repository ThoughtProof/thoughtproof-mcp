/**
 * Auto-route heuristic for verify_decision (no LLM).
 *
 * Explicit mode always wins.
 *
 * mode=auto (default):
 *   - DQL (hero) if mandate / proposed_action / reasoning / context look like
 *     spend, checkout, booking, purchase, payment, cart, Stripe, price,
 *     budget, or cap.
 *   - Sentinel if the text looks like a high-blast irreversible exit
 *     (publish, delete, deploy, send-to-prod, memory write) AND does not
 *     also look like spend.
 *   - Unsure → DQL (hero path).
 */

export type DecisionMode = "dql" | "sentinel" | "auto";
export type DecisionSurface = "dql" | "sentinel";

export interface RouteDecisionInput {
  mandate: string;
  proposed_action: string;
  reasoning: string;
  context?: string;
  mode?: DecisionMode;
}

const SPEND_RE =
  /\b(spend|checkout|booking|book|purchase|payment|pay|cart|stripe|price|budget|cap)\b/i;

const BLAST_RE =
  /\b(publish|delete|deploy|send[-\s]to[-\s]prod|memory[-\s]write|write[-\s]to[-\s]memory)\b/i;

export function routeDecision(input: RouteDecisionInput): DecisionSurface {
  const mode = input.mode ?? "auto";
  if (mode === "dql" || mode === "sentinel") return mode;

  const blob = [input.mandate, input.proposed_action, input.reasoning, input.context ?? ""]
    .join("\n")
    .toLowerCase();

  if (SPEND_RE.test(blob)) return "dql";
  if (BLAST_RE.test(blob)) return "sentinel";
  return "dql";
}
