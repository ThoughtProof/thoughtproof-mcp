# Unreleased (0.3.1) — not the listing surface

This file is a **branch note** for work that is on `main` in source but is **not** the released npm / directory listing.

- npm `latest` is [`thoughtproof-mcp@0.3.0`](https://www.npmjs.com/package/thoughtproof-mcp) (verify-key path).
- `package.json` on the listing surface stays **0.3.0** so GitHub main + the npm README match what directories scrape.
- **Do not publish** this tree as 0.3.1 until DQL #40 (credit-after-success) is fixed, merged, deployed, and live-tested.
- Do not treat 0.3.0 as the `dqla_` path.

The `dqla_` code path is kept in source. It is not advertised on `README.md`.

## Account-token path (`dqla_`)

Desktop / CLI hosts can use the account token `dqla_…` shown **once** on checkout reveal. Hold that same token for `GET /dql/account` — the account route uses it; it does not issue a new one. You do **not** need to paste the raw verify key `dqlk_…`.

The `dqla_` path needs a DQL deploy that accepts `X-DQL-Account` on `POST /dql/verify`.

Local-only config (not the released install card):

```json
{
  "mcpServers": {
    "thoughtproof": {
      "command": "npx",
      "args": ["-y", "thoughtproof-mcp"],
      "env": {
        "DQL_ACCOUNT_TOKEN": "dqla_your_account_token"
      }
    }
  }
}
```

`DQL_API_KEY` (alias `THOUGHTPROOF_DQL_KEY`) still works: set it to `dqlk_…` for the raw verify key, or to `dqla_…` for the same account-token path. If both a `dqlk_` key and a `dqla_` token are set, only the key is sent.

To run this unpublished path from a checkout: `npm run build`, then point the host at `dist/index.js`.

## Changelog notes

### Added

- `verify_decision` accepts a DQL account token (`dqla_…`) via `DQL_ACCOUNT_TOKEN` or the same env as the verify key when the value starts with `dqla_`. Sent as `X-DQL-Account` only (never together with `X-DQL-Key` or `Authorization`).
- Desktop / CLI stdio hosts can use the `dqla_…` token shown once on checkout reveal (hold the same token for `GET /dql/account`; that route does not issue it) instead of pasting a raw `dqlk_` verify key. Remote MCP is out of scope.
- Fail-closed on DQL `401 ACCOUNT_UNAUTHORIZED`: `execute: false`, exactly one HTTP request, no token echo.

### Changed

- DQL auth sends exactly one credential header: `X-DQL-Account` for `dqla_`, `X-DQL-Key` for `dqlk_`.

### Unchanged

- `dqlk_` via `DQL_API_KEY` / `THOUGHTPROOF_DQL_KEY` still sends `X-DQL-Key`.
- `execute: true` only on native ALLOW. Missing credentials still fail closed.

## Configuration (unpublished)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DQL_ACCOUNT_TOKEN` | *(none)* | Account token (`dqla_…`) from checkout reveal (shown once). Hold it for `GET /dql/account`; that route uses the token, it does not mint one. No raw `dqlk_` paste. Sent as `X-DQL-Account` only. Requires DQL that accepts `X-DQL-Account` on `/dql/verify`. |
| `DQL_API_KEY` | *(none)* | DQL verify key (`dqlk_…`) or account token (`dqla_…`) for `verify_decision`. Alias: `THOUGHTPROOF_DQL_KEY`. A `dqlk_` value wins over `dqla_` so both are never sent. |
