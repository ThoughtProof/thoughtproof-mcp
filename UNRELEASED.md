# Unpublished 0.4.0-dev

## Sentinel mandate quote (unpublished tree)

`verify_before_action` / `verify_decision` (mode=sentinel) now put a **verbatim quote of the user mandate** into the outbound Sentinel `evidence` blob, along with proposed action and reasoning.

Live Sentinel (`ALLOWED_BODY_FIELDS`) rejects a top-level `quote` with HTTP 400, so the quote is **not** sent as a sibling field. PLV provenance requires the cascade's quote to be a substring of `evidence`; omitting that span produced spurious `PROVENANCE DOWNGRADE: quote invalid or missing` even when the mandate was clear.

Optional MCP/`verifyDecision` input `quote`: used only when it is an exact substring of `mandate` **and at least 20 characters** (after trim). Shorter host quotes, paraphrases, and whitespace-only mismatches fall back to the full mandate. If the host quote matches only after collapsing newlines/spaces, evidence includes a `[ThoughtProof quote]` note explaining the fallback. Empty or whitespace-only `mandate` fails closed (`MANDATE_REQUIRED`, `execute: false`) and does not call Sentinel. DQL path unchanged. `execute` still true only on ALLOW. Published pin stays **thoughtproof-mcp@0.3.2**.

Contract test (`test/sentinel-openapi-contract.test.js`) fetches live `openapi.json` and fails if outbound body keys are not a subset of documented `POST /sentinel/verify` properties, or if `SENTINEL_OPENAPI_VERIFY_BODY_FIELDS` drifts from that set. No top-level `quote`. Does not POST `/sentinel/verify`.

## Structured objections / repair loop (unpublished tree)

Envelope now includes `structured_objections[]` (id, code, severity `block`|`blocked_until`, claim, message, repair_hints) plus `loop` and optional `in_reply_to`. Compat: `objections: string[]` unchanged. `execute` still true only on ALLOW.

This is **not** a DQL/Sentinel API change. Mapping is local (DQL axes / Sentinel objection objects → structured). Host must honor `execute=false`. Next call with `in_reply_to` is a **new** receipt; prior ALLOW does not carry. No npm publish of this tree.


This tree is **not** the Official Registry / npm listing surface. Do not publish this tree.

Crawlers should read [README.md](./README.md), `server.json`, and `glama.json`. Those files describe the **published** product (`thoughtproof-mcp@0.3.2`). This file is the only public doc that describes the unpublished path.

## Identity

- **npm 0.3.1** (when published) is a metadata-only listing tarball cut from the real 0.3.0 tree (`d70470b`). Same runtime as 0.3.0; **no `dqla_`**.
- **This tree** is unpublished `0.4.0-dev`. It continues the `dqla_` / `DQL_ACCOUNT_TOKEN` / `X-DQL-Account` path from #4. It is **not** the npm pin.
- `package.json` version stays `0.4.0-dev`. `mcpName` is present so a later 0.4.0 release keeps Official Registry ownership.
- `server.json` on this tree points at the **published** npm package `thoughtproof-mcp@0.3.2` (not `0.4.0-dev`).

Do not treat `0.3.0` or `0.3.1` as the `dqla_` path.

## `dqla_` / `DQL_ACCOUNT_TOKEN`

`verify_decision` accepts a DQL account token (`dqla_…`) via `DQL_ACCOUNT_TOKEN`, or via the same env as the verify key when the value starts with `dqla_`. It is sent as `X-DQL-Account` only — never together with `X-DQL-Key` or `Authorization`.

Desktop / CLI stdio hosts can use the `dqla_…` token shown **once** on checkout reveal. Hold that same token for `GET /dql/account` — the account route uses it; it does not issue a new one. You do **not** need to paste the raw verify key `dqlk_…`.

The `dqla_` path needs a DQL deploy that accepts `X-DQL-Account` on `POST /dql/verify`. Do not publish this MCP package until DQL #40 (credit-after-success) is fixed, merged, deployed, and live-tested.

Fail-closed on DQL `401 ACCOUNT_UNAUTHORIZED`: `execute: false`, exactly one HTTP request, no token echo.

`DQL_API_KEY` (alias `THOUGHTPROOF_DQL_KEY`) still works: set it to `dqlk_…` for the raw verify key, or to `dqla_…` for the same account-token path. If both a `dqlk_` key and a `dqla_` token are set, only the key is sent.

## Local install (this tree only)

Build locally, then point the host at `dist/index.js`. Do not `npx thoughtproof-mcp@0.3.2` for `dqla_`.

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "node",
      "args": ["/absolute/path/to/thoughtproof-mcp/dist/index.js"],
      "env": {
        "DQL_ACCOUNT_TOKEN": "<YOUR_DQL_ACCOUNT_TOKEN>"
      }
    }
  }
}
```

```bash
npm install
npm run build
npm test
```

This package remains a **local stdio** MCP server (Node 18+) for Desktop / CLI hosts. It is not a remote HTTP MCP server and not a Grok Web/Mobile connector. `execute` is `true` only on a native `ALLOW`.
