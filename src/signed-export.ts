/**
 * Fail-closed check of Sentinel's signed canonical export.
 *
 * Mirrors scripts/verify-canonical-export.mjs (thoughtproof-sentinel):
 *   key window vs signedAt → Ed25519(domain || 0x00 || JCS(fields)) →
 *   sha256(transported canonical) → validUntil vs verifier clock.
 *
 * execute is granted only by gateOuterVerdict, and only when the signed
 * verdict is ALLOW and matches the outer verdict. A valid signature never
 * promotes BLOCK / UNCERTAIN / anything else to ALLOW.
 *
 * Key material is the pinned public documents in sentinel-key-pin.ts.
 * SENTINEL_API_KEY / X-Sentinel-Key is an API credential, not this key.
 * Optional SENTINEL_EXPORT_KEYS_JSON replaces the export pin (public keys
 * only). TP_REQUIRE_SIGNED_BINDING defaults to required; "0" is the
 * compatibility escape.
 */

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import {
  PINNED_EXPORT_KEYS,
  PINNED_VALIDATION_KEYS,
  type ExportKeyEntry,
  type ExportKeysDoc,
} from "./sentinel-key-pin.js";

export const EXPORT_DOMAIN = "thoughtproof.sentinel.export.v1";
export const EXPORT_ALG = "Ed25519";
export const SCHEMA_V1 = "sentinel.verdict.canonical.v1";
export const SCHEMA_V2 = "sentinel.verdict.canonical.v2";

/** Unset means required. Only an explicit off value trusts the outer verdict. */
export const SIGNED_BINDING_ENV = "TP_REQUIRE_SIGNED_BINDING";
/** Public export-key document. Replaces the in-repo pin when set. */
export const EXPORT_KEYS_JSON_ENV = "SENTINEL_EXPORT_KEYS_JSON";

const ACCEPTED_SCHEMAS = new Set([SCHEMA_V1, SCHEMA_V2]);

export interface SentinelBindingOptions {
  /** Default: signedBindingRequired(env). */
  requireSignedBinding?: boolean;
  /** Test or operator export-key document. Public keys only. */
  keysDoc?: ExportKeysDoc;
  /** Verifier clock, unix seconds. Default: now. */
  nowSeconds?: number;
  /** Accept status=vector-only. Default false. Not an env flag. */
  allowVectorOnly?: boolean;
  /** When set, flag and keys JSON are read from here instead of process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface BindingAssessment {
  ok: boolean;
  code: string;
  signedVerdict?: string;
  keyId?: string;
}

export interface OuterVerdictGate {
  verdict: string;
  execute: boolean;
  code: string;
}

interface SignedFields {
  artifactSchema: string;
  verificationId: string;
  canonical: string;
  digest: string;
  keyId: string;
  alg: typeof EXPORT_ALG;
  signedAt: number;
  validUntil?: number;
}

function bindingEnv(options?: SentinelBindingOptions): NodeJS.ProcessEnv {
  return options?.env ?? process.env;
}

export function signedBindingRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[SIGNED_BINDING_ENV];
  if (raw === undefined || String(raw).trim() === "") return true;
  const value = String(raw).trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Flat JCS for the export envelope. Same encoding as Sentinel's portable verifier. */
export function canonicalJsonFlat(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined) continue;
    let encoded: string;
    if (typeof value === "string") encoded = JSON.stringify(value);
    else if (typeof value === "number" && Number.isFinite(value)) encoded = JSON.stringify(value);
    else if (typeof value === "boolean") encoded = value ? "true" : "false";
    else throw new Error(`canonicalJsonFlat: unsupported type for ${key}`);
    parts.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${parts.join(",")}}`;
}

export function buildExportSignedInput(fields: SignedFields): Buffer {
  const body: Record<string, unknown> = {
    artifactSchema: fields.artifactSchema,
    verificationId: fields.verificationId,
    canonical: fields.canonical,
    digest: fields.digest,
    keyId: fields.keyId,
    alg: fields.alg,
    signedAt: fields.signedAt,
  };
  if (fields.validUntil !== undefined) body.validUntil = fields.validUntil;
  return Buffer.concat([
    Buffer.from(EXPORT_DOMAIN, "utf8"),
    Buffer.from([0x00]),
    Buffer.from(canonicalJsonFlat(body), "utf8"),
  ]);
}

export function digestTransportedCanonical(canonical: string): string {
  return `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function findKey(doc: ExportKeysDoc | null | undefined, keyId: string): ExportKeyEntry | undefined {
  return doc?.keys?.find((entry) => entry.kid === keyId || entry.keyId === keyId);
}

function parseKeysJson(raw: string): ExportKeysDoc | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Refuse to ingest private key material. Do not log the value.
  if (/PRIVATE KEY|BEGIN OPENSSH|EXPORT_PRIVATE/i.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed) as ExportKeysDoc;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keys)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resolveExportKeysDoc(options?: SentinelBindingOptions): ExportKeysDoc {
  if (options?.keysDoc) return options.keysDoc;
  const raw = bindingEnv(options)[EXPORT_KEYS_JSON_ENV];
  if (raw !== undefined && String(raw).trim() !== "") {
    return parseKeysJson(String(raw)) ?? { keys: [] };
  }
  return PINNED_EXPORT_KEYS;
}

function unixFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(n) ? n : null;
}

function resolvePublicKey(entry: ExportKeyEntry): KeyObject {
  if (entry.kty === "OKP" && entry.crv === "Ed25519" && typeof entry.x === "string") {
    return createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: entry.x },
      format: "jwk",
    });
  }
  if (entry.publicKeyPem) return createPublicKey(entry.publicKeyPem);
  if (entry.publicKey && /^[0-9a-fA-F]{64}$/.test(entry.publicKey)) {
    const raw = Buffer.from(entry.publicKey, "hex");
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    return createPublicKey({ key: spki, format: "der", type: "spki" });
  }
  throw new Error("key entry missing public material");
}

function keyUsable(
  entry: ExportKeyEntry,
  allowVectorOnly: boolean,
  signedAt: number,
): { ok: true } | { ok: false; code: string } {
  const status = entry.status || "active";
  if (status === "vector-only") {
    if (!allowVectorOnly) return { ok: false, code: "vector_only_key_not_allowed" };
  } else if (status !== "active" && status !== "retired") {
    return { ok: false, code: "key_status_unusable" };
  }
  if (!Number.isFinite(signedAt)) return { ok: false, code: "missing_fields" };
  const notBefore = unixFromIso(entry.notBefore);
  if (notBefore !== null && signedAt < notBefore) return { ok: false, code: "key_not_yet_valid" };
  const notAfter = unixFromIso(entry.notAfter);
  if (notAfter !== null && signedAt > notAfter) return { ok: false, code: "key_expired" };
  return { ok: true };
}

function fail(code: string, keyId?: string): BindingAssessment {
  return keyId ? { ok: false, code, keyId } : { ok: false, code };
}

function verifyArtifact(
  artifact: Record<string, unknown>,
  expectedSchema: string,
  options: SentinelBindingOptions | undefined,
  keysDoc: ExportKeysDoc,
): BindingAssessment & { canonical?: string; verificationId?: string } {
  const required = [
    "artifactSchema",
    "verificationId",
    "canonical",
    "digest",
    "keyId",
    "alg",
    "signedAt",
    "signature",
  ];
  for (const field of required) {
    if (artifact[field] === undefined || artifact[field] === null) {
      return fail("missing_fields");
    }
  }
  if (artifact.artifactSchema !== expectedSchema) return fail("schema_field_mismatch");
  if (artifact.alg !== EXPORT_ALG) return fail("alg_unsupported", String(artifact.keyId));
  if (typeof artifact.artifactSchema !== "string" || !ACCEPTED_SCHEMAS.has(artifact.artifactSchema)) {
    return fail("schema_unsupported", String(artifact.keyId));
  }
  if (typeof artifact.digest !== "string" || !/^0x[0-9a-f]{64}$/.test(artifact.digest)) {
    return fail("bad_digest_format", String(artifact.keyId));
  }
  if (typeof artifact.signedAt !== "number" || !Number.isFinite(artifact.signedAt)) {
    return fail("missing_fields", String(artifact.keyId));
  }
  if (typeof artifact.canonical !== "string" || typeof artifact.verificationId !== "string") {
    return fail("missing_fields", String(artifact.keyId));
  }
  if (typeof artifact.keyId !== "string" || typeof artifact.signature !== "string") {
    return fail("missing_fields");
  }

  const keyId = artifact.keyId;
  const exportEntry = findKey(keysDoc, keyId);
  if (!exportEntry) {
    if (findKey(PINNED_VALIDATION_KEYS, keyId)) {
      return fail("validation_key_not_export_signer", keyId);
    }
    return fail("key_not_found", keyId);
  }
  const usable = keyUsable(exportEntry, options?.allowVectorOnly === true, artifact.signedAt);
  if (!usable.ok) return fail(usable.code, keyId);

  let publicKey: KeyObject;
  try {
    publicKey = resolvePublicKey(exportEntry);
  } catch {
    return fail("key_unusable", keyId);
  }

  const fields: SignedFields = {
    artifactSchema: artifact.artifactSchema,
    verificationId: artifact.verificationId,
    canonical: artifact.canonical,
    digest: artifact.digest,
    keyId,
    alg: EXPORT_ALG,
    signedAt: artifact.signedAt,
  };
  if (artifact.validUntil !== undefined) {
    if (typeof artifact.validUntil !== "number" || !Number.isFinite(artifact.validUntil)) {
      return fail("missing_fields", keyId);
    }
    fields.validUntil = artifact.validUntil;
  }

  const sigHex = artifact.signature.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{128}$/.test(sigHex)) return fail("signature_invalid", keyId);
  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      null,
      buildExportSignedInput(fields),
      publicKey,
      Buffer.from(sigHex, "hex"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return fail("signature_invalid", keyId);

  if (digestTransportedCanonical(artifact.canonical) !== artifact.digest) {
    return fail("digest_mismatch", keyId);
  }

  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (fields.validUntil !== undefined && now > fields.validUntil) {
    return fail("expired", keyId);
  }

  return {
    ok: true,
    code: "ok",
    keyId,
    canonical: artifact.canonical,
    verificationId: artifact.verificationId,
  };
}

function verdictFromCanonical(canonical: string): string | null {
  try {
    const parsed = JSON.parse(canonical) as { verdict?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.verdict !== "string") return null;
    if (!parsed.verdict.trim()) return null;
    return parsed.verdict;
  } catch {
    return null;
  }
}

function selectArtifacts(
  body: Record<string, unknown>,
): { ok: true; artifacts: { value: Record<string, unknown>; schema: string }[] } | { ok: false; code: string } {
  const present: { field: "signed_export" | "signed_export_v2"; schema: string }[] = [];
  if (Object.prototype.hasOwnProperty.call(body, "signed_export")) {
    present.push({ field: "signed_export", schema: SCHEMA_V1 });
  }
  if (Object.prototype.hasOwnProperty.call(body, "signed_export_v2")) {
    present.push({ field: "signed_export_v2", schema: SCHEMA_V2 });
  }
  if (present.length === 0) return { ok: false, code: "missing_export" };
  const artifacts: { value: Record<string, unknown>; schema: string }[] = [];
  for (const item of present) {
    const value = body[item.field];
    if (!isPlainObject(value)) return { ok: false, code: "invalid_export" };
    artifacts.push({ value, schema: item.schema });
  }
  return { ok: true, artifacts };
}

/**
 * Verify every present signed export on a Sentinel response.
 * Does not compare the outer verdict; gateOuterVerdict does that.
 */
export function assessSentinelBinding(
  body: unknown,
  options?: SentinelBindingOptions,
): BindingAssessment {
  if (!isPlainObject(body)) return fail("invalid_export");
  const selected = selectArtifacts(body);
  if (!selected.ok) return fail(selected.code);

  const responseId = typeof body.id === "string" ? body.id : "";
  const keysDoc = resolveExportKeysDoc(options);
  let signedVerdict: string | undefined;
  let keyId: string | undefined;

  for (const artifact of selected.artifacts) {
    const verified = verifyArtifact(artifact.value, artifact.schema, options, keysDoc);
    if (!verified.ok) return verified;
    keyId = verified.keyId;
    if (!responseId || verified.verificationId !== responseId) {
      return fail("receipt_mismatch", verified.keyId);
    }
    const verdict = verdictFromCanonical(verified.canonical ?? "");
    if (!verdict) return fail("verdict_missing", verified.keyId);
    if (signedVerdict !== undefined && signedVerdict.toUpperCase() !== verdict.toUpperCase()) {
      return fail("export_disagreement", verified.keyId);
    }
    signedVerdict = verdict;
  }

  if (!signedVerdict) return fail("verdict_missing", keyId);
  return { ok: true, code: "ok", signedVerdict, keyId };
}

/**
 * execute is true only when binding is satisfied and the signed verdict is ALLOW.
 * On mismatch, the reported verdict is the non-ALLOW side.
 * When binding is disabled, the outer verdict is trusted (compatibility only).
 */
export function gateOuterVerdict(
  outerVerdict: unknown,
  body: unknown,
  options?: SentinelBindingOptions,
): OuterVerdictGate {
  const outer = String(outerVerdict ?? "ERROR");
  const required = options?.requireSignedBinding ?? signedBindingRequired(bindingEnv(options));
  if (!required) {
    return {
      verdict: outer,
      execute: outer.toUpperCase() === "ALLOW",
      code: "binding_not_required",
    };
  }

  const assessed = assessSentinelBinding(body, options);
  if (!assessed.ok) {
    if (outer.toUpperCase() === "ALLOW") {
      return { verdict: "ERROR", execute: false, code: assessed.code };
    }
    return { verdict: outer, execute: false, code: assessed.code };
  }

  const signed = assessed.signedVerdict ?? "";
  if (signed.toUpperCase() !== outer.toUpperCase()) {
    const reported = signed.toUpperCase() === "ALLOW" ? outer : signed;
    return {
      verdict: reported.toUpperCase() === "ALLOW" ? "ERROR" : reported,
      execute: false,
      code: "verdict_mismatch",
    };
  }

  if (signed.toUpperCase() === "ALLOW") {
    return { verdict: "ALLOW", execute: true, code: "ok" };
  }
  return { verdict: outer, execute: false, code: "signed_not_allow" };
}
