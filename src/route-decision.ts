/**
 * Auto-route heuristic for verify_decision (no LLM).
 *
 * Explicit mode always wins, including mode=dql on a command-form action.
 *
 * mode=auto (default):
 *   - Sentinel if the proposed action is command form, or action_kind is
 *     local_command. Command form (proposed_action only):
 *       a `run_command:` label, a shell prompt line (`$` + command),
 *       or a fenced code block (```).
 *     This beats spend language, so a word like "budget" in the mandate
 *     cannot keep a shell action on DQL. Markers in reasoning or context
 *     do not count. mandate_kind does not count.
 *     This is not a shell parser and not an allow: Sentinel still decides.
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
  /**
   * Host-declared action kind. Only the exact value `local_command`
   * (after trim) changes auto-routing. Other kinds, including invalid
   * ones, leave the text heuristic in charge.
   */
  action_kind?: string;
}

/** Coding-agent command label, e.g. `run_command: git status`. */
const RUN_COMMAND_RE = /\brun_command[ \t]*:/i;

/**
 * A line whose first token is a shell prompt `$` followed by a command.
 * `$180` and `the fare is $ 180` do not match.
 */
const COMMAND_PROMPT_LINE_RE = /(?:^|\n)[ \t]*\$[ \t]+\S/;

/** Fenced code block. Inline single backticks are not command form. */
const FENCED_CODE_BLOCK_RE = /```/;

export function isCommandFormAction(proposedAction: string): boolean {
  const action = String(proposedAction ?? "");
  return (
    RUN_COMMAND_RE.test(action) ||
    COMMAND_PROMPT_LINE_RE.test(action) ||
    FENCED_CODE_BLOCK_RE.test(action)
  );
}

function isDeclaredLocalCommand(actionKind: unknown): boolean {
  return typeof actionKind === "string" && actionKind.trim() === "local_command";
}

const SPEND_RE =
  /\b(spend|checkout|booking|book|purchase|payment|pay|cart|stripe|price|budget|cap)\b/i;

const BLAST_RE =
  /\b(publish|delete|deploy|send[-\s]to[-\s]prod|memory[-\s]write|write[-\s]to[-\s]memory)\b/i;

export function routeDecision(input: RouteDecisionInput): DecisionSurface {
  const mode = input.mode ?? "auto";
  if (mode === "dql" || mode === "sentinel") return mode;

  if (isDeclaredLocalCommand(input.action_kind) || isCommandFormAction(input.proposed_action)) {
    return "sentinel";
  }

  const blob = [input.mandate, input.proposed_action, input.reasoning, input.context ?? ""]
    .join("\n")
    .toLowerCase();

  if (SPEND_RE.test(blob)) return "dql";
  if (BLAST_RE.test(blob)) return "sentinel";
  return "dql";
}
