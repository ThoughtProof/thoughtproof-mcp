# Sentinel request binding

Status: MCP check is in this tree. Sentinel does not issue `requestHash` yet. Until it does, a signed ALLOW on `verify_before_action` / `verify_decision` returns `execute: false`. This file is the contract and the change proposal. It does not change Sentinel.

The positive test that returns `execute: true` uses a synthetic export signed by an ephemeral key in the test process. That fixture proves only that this MCP compares `requestHash`. It is not a Sentinel issuance and it is not evidence that production Sentinel binds the command.

## What the signed export binds today

Sentinel creates the export and signs it. This MCP checks the signature, the export digest, expiry, the receipt id, and the verdict, then passes the export through unchanged. Before this change it did not receive the current mandate or proposed action, so one validly signed ALLOW could be replayed for a different command.

Sources below are `ThoughtProof/thoughtproof-sentinel` main (read for this note; not modified).

### Export digest

`signed_export.digest` and `signed_export_v2.digest` are `0x` plus the SHA-256 hex of the transported canonical string (UTF-8). The Ed25519 signature is over:

```text
"thoughtproof.sentinel.export.v1" || 0x00 || JCS(envelope)
```

The envelope is the flat object `{ artifactSchema, verificationId, canonical, digest, keyId, alg, signedAt, validUntil? }`. The signature therefore binds those bytes, including the canonical string. It does not by itself bind a field that is absent from that canonical string.

The canonical body (`src/canonical-verdict.ts`, `buildCanonicalSentinelVerdict`) is a projection of the verdict: schema, verification id, API version, tier, mode, verdict, confidence, objections, reasoning, evaluatedAt, models, and, only when present, `packageDigest`, `proofStrength`, and `gate`. v2 adds optional provenance (`releaseId`, `policy`, `potCli`, `mandateDigest`, `actionDigest`, `mandateSource`, gate `checked` / `skipped`). The MCP path's full mandate text and the command are not fields of that projection.

### mandateDigest and actionDigest

`src/package-digest.ts` defines both as `sha256:` plus the lowercase hex of SHA-256 over `32 random bytes || UTF-8 JCS(value)`.

- `mandateDigest` hashes the structured `mandate` object.
- `actionDigest` hashes `mandate.action` only, when that property is present.

The salt is returned to the caller as `meta.digest_salt` (`api/sentinel/verify.ts`) and is not a field of the signed canonical (`canonical-verdict.ts`: "The salt itself is not in this body"). The digests are copied into v2 only, and the comments mark them as not a verdict input.

On this MCP's current call, `buildSentinelVerifyBody` sends `mandate` only as `{ kind?, action?: { kind } }`, or omits it. The full mandate text and the command are inside the `evidence` string (and the command is also inside `claim` plus the suffix ` is authorized by the principal's mandate`). A salted hash of `{ kind: "local_command" }` does not contain the mandate text or the command. This MCP does not treat `mandateDigest` or `actionDigest` as `requestHash`.

### packageDigest

`computePackageDigest` is SHA-256 of the JCS of the whole validated verify request, prefixed `sha256:`. `applyEvidenceEffects` (`src/evidence-processing.ts`) attaches `meta.package_digest` only when `signed_evidence` is present and non-empty. The comment there states that requests without `signed_evidence` must keep the pre-F1 response shape, and the canonical body must not gain the field. The canonical builder copies `packageDigest` only from `meta.package_digest`.

This MCP does not send `signed_evidence`. On this path `packageDigest` is not in the export. This MCP does not treat it as `requestHash`.

## MCP rule

`execute: true` on the Sentinel route requires all of the existing checks (signature, export digest, key, receipt id, fresh `validUntil`, signed verdict ALLOW, outer verdict matches) and:

- every present export (`signed_export` and `signed_export_v2`, if that field is present) has a canonical `requestHash` of the form `sha256:` plus 64 lowercase hex digits
- that value equals the hash of the current request, defined below

If any present export lacks that field, the code is `request_hash_missing` and `execute` is false. If the field is present and differs, the code is `request_hash_mismatch` and `execute` is false. An outer ALLOW in either case is reported as `ERROR`. No flag turns execute back on. `mandateDigest`, `actionDigest`, and `packageDigest` do not fill the gap.

`verify_trade` uses the same gate. A signed ALLOW there also stays non-executing until `requestHash` matches a request object. That client does not yet take `SENTINEL_TEST_MODE` or the deployment-protection header. Those apply to `verify_before_action` / `verify_decision`.

## Request-hash contract

| Item | Value |
| --- | --- |
| Profile | `thoughtproof.mcp.request_binding.v1` |
| Field name | `requestHash`, a string on the canonical JSON object (v1 and v2) |
| Algorithm | SHA-256 |
| Encoding | `sha256:` + lowercase hex, no `0x` prefix |
| Preimage | UTF-8 bytes of the flat JCS document below |

Flat JCS here means: object keys sorted by UTF-16 code unit, string values encoded with `JSON.stringify`, no insignificant whitespace. For this flat string object that is the same encoding as `canonicalJsonFlat` in `src/signed-export.ts` and as RFC 8785.

Required keys are always present. Optional keys are omitted when the argument is missing or whitespace-only.

| Key | Required | Source on this MCP call |
| --- | --- | --- |
| `profile` | yes | the constant above |
| `mandate` | yes | trimmed `mandate` |
| `proposed_action` | yes | trimmed `proposed_action` (the command) |
| `reasoning` | yes | trimmed `reasoning` |
| `context` | no | trimmed `context` after the repair prefix, when non-empty |
| `mandate_kind` | no | trimmed `mandate_kind`, when non-empty |
| `action_kind` | no | trimmed `action_kind`, when non-empty |

Not separate keys: `mode` (routing only; Sentinel always sees `action_authorization`), host `quote` (a span of `mandate`), `in_reply_to` (already inside `context` when set).

Example, pinned by `test/signed-export-binding.test.js`:

```json
{"mandate":"Work locally in this repo.","profile":"thoughtproof.mcp.request_binding.v1","proposed_action":"run_command: git status","reasoning":"Inspect the tree before editing."}
```

`requestHash` is SHA-256 of that UTF-8 string. `run_command: git status` and `run_command: git status &` are different preimages.

The export digest stays the hash of the canonical string. `requestHash` is inside that string, so the existing Ed25519 signature covers it once Sentinel writes the field before signing. This MCP does not re-sign.

## Sentinel change proposal (separate approval)

Do not implement this in Sentinel until it is approved on its own. Suggested shape:

1. When issuing both v1 and v2 canonical bodies, set `requestHash` from the contract above before `maybeIssueSignedExport` / `maybeIssueSignedExportV2`. Omit the export (or do not issue an ALLOW export) if the preimage cannot be built. Do not substitute `mandateDigest`, `actionDigest`, or `packageDigest`.
2. Reconstruct the preimage from the verify request this MCP already sends, without a new top-level body field (today's validator rejects unknown top-level fields):
   - `mandate`: the `User mandate:` block when present, otherwise the `Principal mandate (verbatim quote):` block, trimmed.
   - `proposed_action`: the `Proposed action:` block, trimmed.
   - `reasoning`: the `Agent reasoning:` block, trimmed.
   - `context`: the `Context:` block, trimmed, omitted when absent.
   - `mandate_kind`: `mandate.kind` when it is a non-empty string.
   - `action_kind`: `mandate.action.kind` when it is a non-empty string.
   - `profile`: the constant above.
3. Put the same `requestHash` in v1 and v2. A mismatch between them must not verify as one ALLOW.
4. Keep the salt and the structured commitment digests as they are. They answer a different question and do not cover the command on this path.
5. `packageDigest` remains gated on `signed_evidence`. This MCP path still does not send `signed_evidence`.

Until that ships, this MCP fail-closes. A host that needs `execute: true` cannot get it from a current production export.
