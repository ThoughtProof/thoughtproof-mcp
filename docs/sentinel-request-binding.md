# Sentinel request binding v2

Status: this MCP checks `requestHash`. Sentinel does not issue it yet. Until Sentinel does, a signed ALLOW on `verify_before_action`, `verify_decision`, or `verify_trade` does not execute. This file is the contract and the change proposal. It does not change Sentinel.

Positive tests that return ALLOW use a synthetic export signed by an ephemeral key created in the test process. That proves only this MCP's comparison. It is not a Sentinel issuance and it is not production evidence. The committed v1 and v2 export fixtures use kid `tp-sentinel-export-ed25519-2026-09-vector`. Those files are format vectors for the export envelope, not request-binding evidence.

Shared bodies, JCS strings, and hashes: `test/fixtures/request-binding-v2.json`. Both `buildSentinelVerifyBody` and `buildTradeVerifyBody` are checked against that file.

## Profile and envelope

| Item | Value |
| --- | --- |
| Profile | `thoughtproof.mcp.request_binding.v2` |
| Signed field | `requestHash`, a string on every present export canonical (v1 and v2) |
| Algorithm | SHA-256 |
| Encoding | `sha256:` + lowercase hex |
| Preimage | UTF-8 bytes of the JCS (RFC 8785) of the envelope below |

```json
{ "profile": "thoughtproof.mcp.request_binding.v2", "request": <API body> }
```

`<API body>` is the JSON object this client serialized on `POST /sentinel/verify`. It is built once. That same object is hashed and `JSON.stringify`'d onto the wire. The hash is of the object via JCS, not of one particular serialization, so key order and insignificant whitespace in the JSON text do not change it. Whitespace inside strings is preserved and does change it. JCS does not trim, case-fold, or Unicode-normalize text.

A string value or object key that contains a lone UTF-16 surrogate is not well-formed Unicode. RFC 8785 requires the canonicalization to fail. This encoder throws, and the caller does not send the request (`execute: false` on the decision path, `UNCERTAIN` on the trade path, no fetch). A valid surrogate pair, such as an emoji, is hashed. Sentinel must reject lone surrogates the same way and must not sign a canonicalization of them.

Headers and credentials are not part of the preimage. That includes `X-Sentinel-Key`, `PAYMENT-SIGNATURE`, `User-Agent`, and any deployment-protection header.

## What is in the body

Decision calls (`verify_before_action` / `verify_decision`) send:

| Field | Presence |
| --- | --- |
| `claim` | always |
| `evidence` | always |
| `mode` | always `action_authorization` |
| `tier` | always `checkpoint` or `standard` |
| `mandate` | absent unless the host declared a kind. When present, it is `{ kind?, action?: { kind } }`. It is never `null` on this client. |

Trade calls (`verify_trade`) send:

| Field | Presence |
| --- | --- |
| `claim` | the action string, not trimmed |
| `evidence` | `Thesis: …\n\nReasoning: …`, not trimmed |
| `mode` | always `trade_execution` |
| `tier` | `checkpoint` or `standard` |

`situation` is sent only on the later RV call. It is not part of the Sentinel body, so this hash does not cover it.

## Absence, null, and unknown fields

- A missing optional field is an absent key. It is not sent as `null`.
- A key whose value is `null` is part of the body and is hashed as `null`. That is a different preimage from the absent key.
- `undefined` object members are omitted by JSON and by this JCS. They are the same as absent.
- Unknown keys are kept. The hash is of the whole body. This client does not drop them, and Sentinel must not drop them either.

Two tool calls that produce the same body have the same hash. A `Context:` section written inside `reasoning`, and the same text passed as `context`, are one example: the HTTP bodies are identical, so the hashes are identical. That pair is vector `raul-context-collapse`.

## What this MCP requires before execute

The existing signature, export digest, key, receipt id, fresh `validUntil`, and verdict match still apply. In addition, every present export canonical must carry `requestHash` in the form above, and that value must equal the hash of the body object this call sent, before a signed ALLOW may execute and before any other signed non-BLOCK verdict may be escalated. `BLOCK` stays a hard stop and does not need `requestHash`. `mandateDigest`, `actionDigest`, and `packageDigest` do not satisfy `requestHash`.

Missing hash: `request_hash_missing`. Mismatch: `request_hash_mismatch`. On a signed ALLOW the decision verdict is `ERROR` and `execute` is false. On a signed UNCERTAIN, HOLD, or REVIEW the verdict is `UNCERTAIN` and `execute` is false. No flag turns execute back on. A trade call that fails this check does not call RV, even if a later RV response would have been ALLOW. A signed UNCERTAIN whose `requestHash` matches may still escalate to RV on a non-micro stake, as before.

## v1 limitation

This binding proof covers the Sentinel path, including `verify_trade` at micro stake. It does not cover the full RV pipeline. `situation` is not in the Sentinel body, so it is not bound. This client does not cryptographically verify an RV response against the RV request that was just sent.

## What the export binds today

Unchanged from the previous note, and still not sufficient:

- The export digest is SHA-256 of the canonical verdict string. The signature covers that string.
- `mandateDigest` / `actionDigest` are salted hashes of the structured mandate object and `mandate.action` only. On the decision call that object is the kind object above, or absent. It does not contain the evidence text or the command. The salt is not inside the signed canonical.
- `packageDigest` is attached only when `signed_evidence` is present. Neither client sends `signed_evidence` on these paths.

## Sentinel change proposal

Do not implement this in Sentinel until it is approved on its own.

1. After parsing the verify request, compute `requestHash` as specified here over the parsed body. Use every key that parsed. Do not trim strings. Do not drop unknown keys. Do not reconstruct an earlier tool-argument shape. Reject a lone surrogate in a key or a value. Do not canonicalize it.
2. Sentinel computes that hash itself. It must not copy a client-supplied hash into the signature without recomputing it. A field inside the body is just more body content.
3. Write the same `requestHash` into the v1 and v2 canonical bodies before signing. If the preimage cannot be built, do not issue an ALLOW export.
4. Leave `mandateDigest`, `actionDigest`, and `packageDigest` as they are. They are not this field.

Until that ships, this MCP fail-closes.
