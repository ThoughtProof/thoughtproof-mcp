/**
 * Pinned Sentinel public keys.
 *
 * Copied from ThoughtProof/thoughtproof-sentinel @ d7475d1e528c1d765eba135c6be27b98174d5d96
 * (same blobs on main as of 2026-10-29):
 *   data/thoughtproof-keys.json   — export signatures (signed_export)
 *   data/validation-keys.json     — ERC-8004 validation artifacts (different scheme)
 *
 * These are public keys. The MCP does not receive them from X-Sentinel-Key.
 * Sentinel distributes the export document at
 * https://sentinel.thoughtproof.ai/.well-known/thoughtproof-keys.json
 * and the validation document at
 * https://sentinel.thoughtproof.ai/.well-known/validation-keys.json
 *
 * The export document says the URL alone is not a trust root: receivers pin
 * the kid set out of band. This module is that pin. Decision time does not
 * fetch either well-known URL.
 */

export interface ExportKeyEntry {
  kty?: string;
  crv?: string;
  /** OKP public coordinate (base64url). Not a private key. */
  x?: string;
  kid?: string;
  keyId?: string;
  alg?: string;
  status?: string;
  notBefore?: string | null;
  notAfter?: string | null;
  publicKeyPem?: string;
  publicKey?: string;
}

export interface ExportKeysDoc {
  schema?: string;
  keys?: ExportKeyEntry[];
}

export const EXPORT_KEYS_WELL_KNOWN =
  "https://sentinel.thoughtproof.ai/.well-known/thoughtproof-keys.json";

export const VALIDATION_KEYS_WELL_KNOWN =
  "https://sentinel.thoughtproof.ai/.well-known/validation-keys.json";

/** Production + vector-only public keys. Vector-only is rejected unless a test opts in. */
export const PINNED_EXPORT_KEYS: ExportKeysDoc = {
  schema: "thoughtproof.keys.v1",
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      x: "IuMSTQMowwaP3yaOmlf9unkZAVjvc9MwOOqluXCjFDs",
      kid: "tp-sentinel-export-ed25519-2026-09-vector",
      alg: "EdDSA",
      status: "vector-only",
      notBefore: "2026-07-01T00:00:00Z",
      notAfter: null,
    },
    {
      kty: "OKP",
      crv: "Ed25519",
      x: "rKfORFLuIi74fCI9DZEpefBXcKFU4e_0CuYuSH7Fh98",
      kid: "tp-sentinel-export-ed25519-2026-09",
      alg: "EdDSA",
      status: "active",
      notBefore: "2026-09-12T00:00:00Z",
      notAfter: null,
    },
  ],
};

/**
 * Validation-artifact trust root. Not an export signer.
 * A signed_export whose keyId is only in this set fails closed.
 */
export const PINNED_VALIDATION_KEYS: ExportKeysDoc = {
  schema: "thoughtproof.validation-keys.v1",
  keys: [
    {
      keyId: "tp-validation-ed25519-2026-07",
      alg: "Ed25519",
      status: "active",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAs3pXjznQ51i9Ya0QOdOzeOnVltxUCBtl8xQKm5NqDd0=\n-----END PUBLIC KEY-----\n",
      notBefore: "2026-07-30T00:00:00Z",
      notAfter: null,
    },
  ],
};
