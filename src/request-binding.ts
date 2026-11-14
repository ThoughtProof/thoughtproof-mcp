/**
 * Request-binding preimage for verify_before_action / verify_decision.
 *
 * The signed export must carry `requestHash` = sha256 of this document.
 * mandateDigest, actionDigest, and packageDigest are not this hash.
 * See docs/sentinel-request-binding.md.
 *
 * Flat string JCS: sorted keys, JSON string encoding, no extra whitespace.
 * For this object that matches RFC 8785. canonicalJsonFlat in signed-export.ts
 * is the same encoding; a test pins the two against each other.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const REQUEST_BINDING_PROFILE = "thoughtproof.mcp.request_binding.v1";

/** Field inside the signed export canonical JSON. */
export const REQUEST_HASH_FIELD = "requestHash";

export const REQUEST_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export interface RequestBindingInput {
  mandate?: unknown;
  proposed_action?: unknown;
  reasoning?: unknown;
  context?: unknown;
  mandate_kind?: unknown;
  action_kind?: unknown;
}

function trimmed(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Authorization preimage. Required keys are always present.
 * Optional keys are omitted when blank so an absent argument and a
 * whitespace-only argument hash the same. `mode`, host `quote`, and
 * `in_reply_to` are not separate keys: routing mode is not sent to
 * Sentinel, a repair id is already inside `context`, and a host quote
 * is a span of `mandate`.
 */
export function requestBindingDocument(input: RequestBindingInput): Record<string, string> {
  const doc: Record<string, string> = {
    profile: REQUEST_BINDING_PROFILE,
    mandate: trimmed(input.mandate) ?? "",
    proposed_action: trimmed(input.proposed_action) ?? "",
    reasoning: trimmed(input.reasoning) ?? "",
  };
  const context = trimmed(input.context);
  const mandateKind = trimmed(input.mandate_kind);
  const actionKind = trimmed(input.action_kind);
  if (context !== undefined) doc.context = context;
  if (mandateKind !== undefined) doc.mandate_kind = mandateKind;
  if (actionKind !== undefined) doc.action_kind = actionKind;
  return doc;
}

/** JCS for a flat string object. Skips nothing that is an empty string. */
export function canonicalRequestJson(doc: Record<string, string>): string {
  const keys = Object.keys(doc).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(doc[key])}`);
  }
  return `{${parts.join(",")}}`;
}

export function canonicalRequestBinding(input: RequestBindingInput): string {
  return canonicalRequestJson(requestBindingDocument(input));
}

/** `sha256:` + lowercase hex of the UTF-8 canonical preimage. */
export function computeRequestHash(input: RequestBindingInput): string {
  const hex = createHash("sha256").update(canonicalRequestBinding(input), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function requestHashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
