/**
 * Request binding v2.
 *
 * requestHash is sha256 of the JCS (RFC 8785) of
 *   { "profile": REQUEST_BINDING_PROFILE, "request": <API body> }
 * The API body is the object that was serialized onto the wire.
 * Headers and credentials are not in it. No trimming. Absent keys stay
 * absent; null is a value. Unknown keys are kept.
 * See docs/sentinel-request-binding.md.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const REQUEST_BINDING_PROFILE = "thoughtproof.mcp.request_binding.v2";

/** Field inside the signed export canonical JSON. Computed by Sentinel, not copied from the client. */
export const REQUEST_HASH_FIELD = "requestHash";

export const REQUEST_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export interface RequestBindingEnvelope {
  profile: typeof REQUEST_BINDING_PROFILE;
  request: unknown;
}

export function requestBindingEnvelope(request: unknown): RequestBindingEnvelope {
  return { profile: REQUEST_BINDING_PROFILE, request };
}

/**
 * RFC 8785 JSON Canonicalization Scheme for JSON values.
 * Object keys are sorted by UTF-16 code unit. Undefined object members are
 * omitted (same as JSON.stringify). Undefined array elements become null.
 * Strings are not trimmed or normalized.
 */
export function jcs(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return encodeNumber(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const element = value[i];
      parts.push(element === undefined ? "null" : encode(element));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const member = record[key];
      if (member === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encode(member)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error("JCS: unsupported value");
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
  if (Object.is(value, -0)) return "0";
  return JSON.stringify(value);
}

export function canonicalRequestBinding(request: unknown): string {
  return jcs(requestBindingEnvelope(request));
}

/** `sha256:` + lowercase hex of the UTF-8 JCS envelope. */
export function computeRequestHash(request: unknown): string {
  const hex = createHash("sha256").update(canonicalRequestBinding(request), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function requestHashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
