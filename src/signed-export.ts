/**
 * Fail-closed check of Sentinel's signed canonical export.
 *
 * Mirrors scripts/verify-canonical-export.mjs (thoughtproof-sentinel):
 *   key window vs signedAt → Ed25519(domain || 0x00 || JCS(fields)) →
 *   sha256(transported canonical) → validUntil vs verifier clock.
 *
 * On the Sentinel path, execute is granted only by gateOuterVerdict, and only
 * when the signed verdict is ALLOW, validUntil is still fresh, and that
 * verdict matches the outer verdict. A valid signature never promotes
 * BLOCK / UNCERTAIN / anything else to ALLOW. No flag can skip this.
 *
 * Key material is the pinned public documents in sentinel-key-pin.ts.
 * SENTINEL_API_KEY / X-Sentinel-Key is an API credential, not this key.
 * Optional SENTINEL_EXPORT_KEYS_JSON replaces the export pin (public keys
 * only). TP_REQUIRE_SIGNED_BINDING is ignored for execute; if set off, it
 * is logged and does not change the decision.
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

/**
 * v1 and v2 share this envelope (api/sentinel/verify.ts).
 * `signed_export` must be canonical v1. `signed_export_v2` must be canonical v2.
 * The `canonical` string is opaque JCS: v2 may nest models, gate, and policy
 * inside it. Do not re-serialize that string.
 * Sentinel attaches v2 only when maybeIssueSignedExportV2 returns an export.
 * A signing failure omits the field. It does not send null and does not change v1.
 *
 * validUntil is signed only when SENTINEL_EXPORT_TTL_SECONDS > 0
 * (loadExportSignerFromEnv → issueSignedCanonicalExport). v1 and v2 use that
 * same TTL, so they both include validUntil or both omit it. This checker
 * still requires a fresh validUntil before execute.
 */

/**
 * Historical switch. It does not change execute. An off value is logged
 * and the Sentinel path still requires a verified signed ALLOW.
 */
export const SIGNED_BINDING_ENV = "TP_REQUIRE_SIGNED_BINDING";
/** Public export-key document. Replaces the in-repo pin when set. */
export const EXPORT_KEYS_JSON_ENV = "SENTINEL_EXPORT_KEYS_JSON";
/**
 * Verifier clock may be this many seconds ahead of validUntil.
 * now === validUntil + skew is still fresh. One second later is expired.
 */
export const EXPORT_CLOCK_SKEW_SECONDS = 30;

const ACCEPTED_SCHEMAS = new Set([SCHEMA_V1, SCHEMA_V2]);

export interface SentinelBindingOptions {
  /** Test or operator export-key document. Public keys only. */
  keysDoc?: ExportKeysDoc;
  /** Verifier clock, unix seconds. Default: now. */
  nowSeconds?: number;
  /** Accept status=vector-only. Default false. Not an env flag. */
  allowVectorOnly?: boolean;
  /** When set, keys JSON and the ignored binding flag are read from here. */
  env?: NodeJS.ProcessEnv;
}

export interface BindingAssessment {
  ok: boolean;
  code: string;
  signedVerdict?: string;
  keyId?: string;
}

/** Result the host can use to re-verify. `ok` is signature, key, digest, receipt, and freshness. */
export interface SignedExportVerification {
  ok: boolean;
  code: string;
  key_id?: string;
  signed_verdict?: string;
}

export interface OuterVerdictGate {
  verdict: string;
  execute: boolean;
  code: string;
  /** Original response field, cloned. Absent when the response omitted it. */
  signed_export?: unknown;
  signed_export_v2?: unknown;
  has_signed_export: boolean;
  has_signed_export_v2: boolean;
  verification: SignedExportVerification;
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

let notedIgnoredBindingFlag = false;

function bindingFlagIsOff(env: NodeJS.ProcessEnv): boolean {
  const raw = env[SIGNED_BINDING_ENV];
  if (raw === undefined || String(raw).trim() === "") return false;
  const value = String(raw).trim().toLowerCase();
  return value === "0" || value === "false" || value === "off" || value === "no";
}

/** Always required. Kept so callers can see the flag no longer opens execute. */
export function signedBindingRequired(_env: NodeJS.ProcessEnv = process.env): boolean {
  return true;
}

/** Log once when an operator sets the old bypass. Does not change execute. */
export function noteIgnoredBindingFlag(env: NodeJS.ProcessEnv = process.env): void {
  if (!bindingFlagIsOff(env) || notedIgnoredBindingFlag) return;
  notedIgnoredBindingFlag = true;
  console.error(
    "[thoughtproof-mcp] TP_REQUIRE_SIGNED_BINDING is ignored. Sentinel execute requires a verified signed ALLOW.",
  );
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

  if (fields.validUntil === undefined) {
    return fail("validUntil_required", keyId);
  }
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Fresh through validUntil + skew. The next second is expired.
  if (now > fields.validUntil + EXPORT_CLOCK_SKEW_SECONDS) {
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

function clonePresented(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function presentedExport(body: unknown, field: "signed_export" | "signed_export_v2"): {
  present: boolean;
  value?: unknown;
} {
  if (!isPlainObject(body) || !Object.prototype.hasOwnProperty.call(body, field)) {
    return { present: false };
  }
  return { present: true, value: clonePresented(body[field]) };
}

function verificationOf(
  assessed: BindingAssessment,
  code: string,
  ok: boolean,
): SignedExportVerification {
  const verification: SignedExportVerification = { ok, code };
  if (assessed.keyId) verification.key_id = assessed.keyId;
  if (assessed.signedVerdict) verification.signed_verdict = assessed.signedVerdict;
  return verification;
}

/**
 * Sentinel execute is true only when the signed verdict is ALLOW, fresh,
 * and equal to the outer verdict. The presented export is copied unchanged
 * so the host can re-verify it. The old binding flag is not consulted.
 */
export function gateOuterVerdict(
  outerVerdict: unknown,
  body: unknown,
  options?: SentinelBindingOptions,
): OuterVerdictGate {
  noteIgnoredBindingFlag(bindingEnv(options));
  const outer = String(outerVerdict ?? "ERROR");
  const v1 = presentedExport(body, "signed_export");
  const v2 = presentedExport(body, "signed_export_v2");
  const presented = {
    ...(v1.present ? { signed_export: v1.value } : {}),
    ...(v2.present ? { signed_export_v2: v2.value } : {}),
    has_signed_export: v1.present,
    has_signed_export_v2: v2.present,
  };

  const assessed = assessSentinelBinding(body, options);
  if (!assessed.ok) {
    const verdict = outer.toUpperCase() === "ALLOW" ? "ERROR" : outer;
    return {
      verdict,
      execute: false,
      code: assessed.code,
      ...presented,
      verification: verificationOf(assessed, assessed.code, false),
    };
  }

  const signed = assessed.signedVerdict ?? "";
  if (signed.toUpperCase() !== outer.toUpperCase()) {
    const reported = signed.toUpperCase() === "ALLOW" ? outer : signed;
    const verdict = reported.toUpperCase() === "ALLOW" ? "ERROR" : reported;
    return {
      verdict,
      execute: false,
      code: "verdict_mismatch",
      ...presented,
      verification: verificationOf(assessed, "verdict_mismatch", true),
    };
  }

  if (signed.toUpperCase() === "ALLOW") {
    return {
      verdict: "ALLOW",
      execute: true,
      code: "ok",
      ...presented,
      verification: verificationOf(assessed, "ok", true),
    };
  }
  return {
    verdict: outer,
    execute: false,
    code: "signed_not_allow",
    ...presented,
    verification: verificationOf(assessed, "signed_not_allow", true),
  };
}
