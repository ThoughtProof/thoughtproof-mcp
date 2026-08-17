# Unpublished 0.4.0-dev

This tree is **not** the Official Registry / npm listing surface. Do not publish this tree.

Crawlers should read [README.md](./README.md), `server.json`, and `glama.json`. Those files describe the **published** product (`thoughtproof-mcp@0.3.1`). This file is the only public doc that describes the unpublished path.

## Identity

- **npm 0.3.1** (when published) is a metadata-only listing tarball cut from the real 0.3.0 tree (`d70470b`). Same runtime as 0.3.0; **no `dqla_`**.
- **This tree** is unpublished `0.4.0-dev`. It continues the `dqla_` / `DQL_ACCOUNT_TOKEN` / `X-DQL-Account` path from #4. It is **not** the npm pin.
- `package.json` version stays `0.4.0-dev`. `mcpName` is present so a later 0.4.0 release keeps Official Registry ownership.
- `server.json` on this tree points at the **published** npm package `thoughtproof-mcp@0.3.1` (not `0.4.0-dev`).

Do not treat `0.3.0` or `0.3.1` as the `dqla_` path.

## `dqla_` / `DQL_ACCOUNT_TOKEN`

`verify_decision` accepts a DQL account token (`dqla_…`) via `DQL_ACCOUNT_TOKEN`, or via the same env as the verify key when the value starts with `dqla_`. It is sent as `X-DQL-Account` only — never together with `X-DQL-Key` or `Authorization`.

Desktop / CLI stdio hosts can use the `dqla_…` token shown **once** on checkout reveal. Hold that same token for `GET /dql/account` — the account route uses it; it does not issue a new one. You do **not** need to paste the raw verify key `dqlk_…`.

The `dqla_` path needs a DQL deploy that accepts `X-DQL-Account` on `POST /dql/verify`. Do not publish this MCP package until DQL #40 (credit-after-success) is fixed, merged, deployed, and live-tested.

Fail-closed on DQL `401 ACCOUNT_UNAUTHORIZED`: `execute: false`, exactly one HTTP request, no token echo.

`DQL_API_KEY` (alias `THOUGHTPROOF_DQL_KEY`) still works: set it to `dqlk_…` for the raw verify key, or to `dqla_…` for the same account-token path. If both a `dqlk_` key and a `dqla_` token are set, only the key is sent.

## Local install (this tree only)

Build locally, then point the host at `dist/index.js`. Do not `npx thoughtproof-mcp@0.3.1` for `dqla_`.

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "node",
      "args": ["/absolute/path/to/thoughtproof-mcp/dist/index.js"],
      "env": {
        "DQL_ACCOUNT_TOKEN": "dqla_your_account_token"
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
