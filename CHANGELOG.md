# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.4.0] - 2026-11-15 (proposed, not published)

Proposed npm release from `283bbcf6c2b2e64f7d405bbd4dc3219283716c3f` (`feat: bind local_command requests to signed Sentinel exports (#52)`). This entry is a release-prep draft on branch `release/0.4.0-prep` (draft PR). It has not been tagged or published. Publishing is gated on the DQL live acceptance listed under "Notes for this draft".

The last published npm version is **thoughtproof-mcp@0.3.2** (2026-08-18, git `96ff8e69`, tag `v0.3.2`). This tree was labeled `0.4.0-dev`. There are 52 commits between `v0.3.2` and `283bbcf6`.

`0.3.1` and `0.3.2` were published to npm but were not previously listed in this file. `0.3.1` is a metadata-only listing tarball cut from the `0.3.0` tree. `0.3.2` is the current `latest` pin (`gitHead` `96ff8e69`).

### Breaking (Sentinel path, compared with 0.3.2)

`0.3.2` set `execute: true` from the outer verdict string `ALLOW` and did not check a signed export. Callers that treated a Sentinel `ALLOW` without a fresh, matching, request-bound signed export as executable will now get `execute: false`.

On the Sentinel path, `execute` is `true` only when all of the following hold:

- A signed export verifies (Ed25519 against the pinned public keys).
- The signed verdict is `ALLOW` and matches the outer verdict.
- `validUntil` is present and still fresh. The verifier clock may be up to 30 seconds ahead of `validUntil` (`EXPORT_CLOCK_SKEW_SECONDS`). `now === validUntil + 30` is still fresh; the next second is `expired`.
- Every present export canonical (`signed_export` and/or `signed_export_v2`) carries `requestHash` for this request.

A signed `ALLOW` without `validUntil` does not execute (`validUntil_required`). A signed `ALLOW` whose export lacks a well-formed `requestHash` does not execute (`request_hash_missing`; decision verdict becomes `ERROR`). A `requestHash` that does not match the body that was sent does not execute (`request_hash_mismatch`). Other fail-closed codes include `signature_invalid`, `key_not_found`, `expired`, and `verdict_mismatch`.

Full contract, body fields, and the fail-closed code table: [docs/sentinel-request-binding.md](./docs/sentinel-request-binding.md) (see [Fail-closed codes and freshness](./docs/sentinel-request-binding.md#fail-closed-codes-and-freshness)). Sentinel issues `requestHash` since Sentinel #133 (`39310deb`); against a Sentinel build without #133, a signed `ALLOW` does not execute (`request_hash_missing`).

`TP_REQUIRE_SIGNED_BINDING` does not change `execute`. This package does not cap, shorten, or rewrite Sentinel's TTL; it only checks freshness against the signed `validUntil` plus the 30-second skew.

`requestHash` is SHA-256 of the JCS (RFC 8785) envelope `{ "profile": "thoughtproof.mcp.request_binding.v2", "request": <API body> }`, encoded as `sha256:` plus lowercase hex. The preimage is the API body object that was sent, not a reconstruction of the tool arguments. `mandateDigest`, `actionDigest`, and `packageDigest` do not satisfy `requestHash`.

`BLOCK` stays a hard stop and does not require `requestHash`. A signed `UNCERTAIN`, `HOLD`, or `REVIEW` needs a matching `requestHash` before RV escalation; a miss stays `UNCERTAIN` and does not call RV.

A lone UTF-16 surrogate in a JCS key or value is rejected before fetch (`execute: false` on the decision path, `UNCERTAIN` on the trade path).

### Added

- ActionKind `local_command` on `mandate_kind` / `action_kind`. On `mode=auto`, a command-form `proposed_action` (`run_command:`, a `$` prompt line, or a fenced code block) or `action_kind=local_command` routes to Sentinel ahead of the spend heuristic. Explicit `mode` still wins. This package does not classify the command as read-only or destructive. Structured `granted` / `action.command` fields are not sent.
- Host-declared kinds: `informational` | `value_transfer` | `permission` | `deploy_ship` | `local_command` | `unknown`, sent as nested `mandate.action.kind` (not evidence prose). Omit rather than guess. Invalid values fail closed (`HOST_KIND_INVALID`) without calling Sentinel.
- `verify_before_action` alias tool (same handler as `verify_decision`).
- Sentinel-mode claim is an authorization assertion (`"<proposed_action> is authorized by the principal's mandate"`), not an echo of `proposed_action`.
- Verbatim mandate quote in `evidence` for PLV provenance. Host `quote` must be at least 20 characters and an exact substring of `mandate`; otherwise the full mandate is used. Empty or whitespace mandate fails closed (`MANDATE_REQUIRED`, `execute: false`) without calling Sentinel.
- Structured objections and an `in_reply_to` repair loop. A later `ALLOW` does not carry back to an earlier receipt.
- `verify_decision` accepts a DQL account token (`dqla_…`) via `DQL_ACCOUNT_TOKEN` or the same env as the verify key when the value starts with `dqla_`. Sent as `X-DQL-Account` only, never together with `X-DQL-Key` or `Authorization`. Fail-closed on DQL `401 ACCOUNT_UNAUTHORIZED`.
- `SENTINEL_TEST_MODE` refuses a missing `SENTINEL_URL` before fetch and does not fall back to the production host. A deployment-protection header, if configured, is sent only to the origin of `SENTINEL_URL`. Redirects are not followed.
- `npm test` is offline. `npm run test:live` is opt-in.
- `mcpName` in package.json (`io.github.ThoughtProof/thoughtproof-mcp`).

### Changed

- DQL auth sends exactly one credential header: `X-DQL-Account` for `dqla_`, `X-DQL-Key` for `dqlk_`. If both are set, only the key is sent.
- `@modelcontextprotocol/sdk` is `^1.32.2` (published 0.3.2 used `^1.29.0`). Earlier 1.x releases are affected by advisories fixed in 1.32.0.
- `zod` is `^4.6.7` (was `^3.25.0`). Zod before 4.6.6 is affected by GHSA-mrhx-c7xc-m3w5. The tool schemas use only `z.string()`, `z.enum()`, `.min()`, `.optional()`, and `.describe()`, which behave the same in Zod 4; no source change was needed. The SDK accepts `zod ^3.25 || ^4.0` since 1.23.0.
- `package-lock.json` regenerated: transitive SDK dependencies updated within their ranges (`proxy-addr` 2.0.8, `express` 5.3.0, `body-parser` 2.4.0, `hono` 4.13.18, `@hono/node-server` 2.1.8, `fast-uri` 3.1.9, `ip-address` 10.7.6, `qs` 6.17.1, `express-rate-limit` 8.7.4). `npm audit --omit=dev` reports 0 findings for the lockfile and for a fresh install of the packed tarball.
- `docs/sentinel-request-binding.md` is now included in the npm package so the links in this file resolve inside the tarball too.
- Node.js 20 or newer is required, matching the installed `@hono/node-server` dependency. Passing stdio tests on Node 18 does not extend the supported engine range. CI runs on Node.js 24.
- Zod 4 omits top-level `additionalProperties: false` from the advertised tool schemas. Unknown top-level tool arguments are stripped before the handler, as before; required fields, types and constraints remain validated at runtime. Invalid known inputs still fail with `-32602` before a provider request.
- HTTP User-Agent version strings are aligned to 0.4.0 on the DQL, Sentinel decision and general API paths.

### Unchanged

- `execute: true` still requires a native `ALLOW` on the DQL path.
- `dqlk_` via `DQL_API_KEY` / `THOUGHTPROOF_DQL_KEY` still sends `X-DQL-Key`.
- This package remains a local stdio MCP server. It is not a remote HTTP MCP server.

### Notes for this draft

- **Publish gate (open):** `UNRELEASED.md` still says not to publish until DQL #40 (credit-after-success) and #44 (no billing without a provider answer) are deployed and live-tested. Both are merged. Live acceptance has not been established for this release: success charged once, provider failure without an answer not charged, and a DQL API replay with the same explicit `Idempotency-Key` not charged twice. Offline tests in the DQL repository cover all three; they do not satisfy the gate.
- MCP 0.4.0 sends neither `Idempotency-Key` nor `X-Request-Id` to DQL and does not automatically retry. Repeated host tool calls are new verifications and can be billed separately. DQL-side replay tests do not establish end-to-end MCP idempotency.
- The request-binding contract is [docs/sentinel-request-binding.md](./docs/sentinel-request-binding.md). It no longer says that Sentinel does not issue `requestHash`.

## [0.3.0] - 2026-08-15

Published to npm as [`thoughtproof-mcp@0.3.0`](https://www.npmjs.com/package/thoughtproof-mcp) (`latest`).

### Added
- Hero tool `verify_decision` — mandate + proposed_action + reasoning routes internally to DQL (`POST /dql/verify`) or Sentinel (`POST /sentinel/verify` with `mode=action_authorization`). Soft fail-closed `execute` flag (`true` only on native `ALLOW`).
- `execute: true` only on native ALLOW; fail-closed on missing key / 4xx / 5xx / timeout.
- Default timeouts raised for live p95 headroom: DQL 60s, Sentinel 90s.

### Unchanged
- `verify_claim` / `check_agent_score`

## [0.2.1] - 2026-05-26

### Fixed
- Corrected pipeline description: 3–4 models evaluate independently → 1 red-team critic → 1 synthesizer (was incorrectly described as "models challenge each other")
- Updated architecture diagram to show 3-stage pipeline accurately
- Fixed glama.json description

## [0.2.0] - 2026-05-26

### Changed
- Upgraded `@modelcontextprotocol/sdk` from `^1.0.0` to `^1.29.0`
- Added `repository`, `homepage`, `bugs`, and `engines` metadata to package.json
- Expanded keyword coverage for MCP registry discoverability
- Improved error handling for non-JSON API error responses

### Added
- Unit test suite (`test/`) with Node.js native test runner
- GitHub Actions CI workflow (lint, build, test on Node 18/20/22)
- CHANGELOG.md
- `prepublishOnly` script to enforce build + test before publish

## [0.1.0] - 2026-03-26

### Added
- Initial release
- `verify_claim` tool — adversarial multi-model verification (4 LLMs)
- `check_agent_score` tool — ERC-8004 agent trust score lookup
- x402 micropayment support (USDC on Base)
- Smithery and Glama registry configs
- Claude Desktop, Cursor, Windsurf setup instructions
