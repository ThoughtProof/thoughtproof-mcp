# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `0.3.x` (npm latest pin) | Yes |
| `main` / unpublished `0.4.0-dev` | Best-effort; breaking changes possible |
| `< 0.3.0` | No |

## What this package is

`thoughtproof-mcp` is a **local stdio MCP server**. It does not hard-kill the host process. Soft fail-closed means: missing keys, timeouts, HTTP 4xx/5xx, and non-ALLOW verdicts return `execute: false`. The host must honor that flag.

It is **not** a remote HTTP MCP endpoint and **not** an identity / trust-score product. A catalog listing or HOL Guard score is **not** authorization to take the next action.

## Reporting a vulnerability

Please report security issues privately:

- Email: **security@thoughtproof.ai**
- Or open a **private** GitHub security advisory on [ThoughtProof/thoughtproof-mcp](https://github.com/ThoughtProof/thoughtproof-mcp/security/advisories/new)

Include: affected version / commit, reproduction steps, impact, and whether keys or customer data were exposed.

Do **not** open a public issue for unfixed vulnerabilities. Do **not** paste live API keys (`dqlk_…`, `dqla_…`, Sentinel keys) into issues or PRs.

We aim to acknowledge reports within **72 hours** and to ship a fix or mitigation for confirmed issues as soon as practical.

## Secrets and credentials

| Do | Don't |
|---|---|
| Pass keys via MCP host `env` (`DQL_API_KEY`, `SENTINEL_API_KEY`, `THOUGHTPROOF_API_KEY`) | Commit `.env`, key files, or real `dqlk_` / `dqla_` strings |
| Use `dqlk_…` for MCP hero `verify_decision` | Put `dqla_…` account tokens in MCP connector secrets |
| Rotate any key that appeared in chat, logs, or a PR | Rely on chat “Saved secret” widgets as proof the MCP process has the key |

Local operator wrappers (e.g. loading a key file then `npx`) must keep key files mode `600` and out of git.

## Supply chain

- CI pins third-party GitHub Actions to **immutable commit SHAs**
- Dependabot watches npm and GitHub Actions
- Optional / recommended: HOL `ai-plugin-scanner-action` on push and pull_request (see `.github/workflows/hol-scanner.yml`)
- A passing scanner score is a **review baseline**, not a guarantee the software is risk-free, and **not** a next-action authorization

## Scope notes

- Network calls go to ThoughtProof verification APIs configured by the operator (DQL / Sentinel / RV). Review those endpoints and your key scopes before production use.
- `verify_decision` / `verify_before_action` never set `execute: true` except on native `ALLOW`.
- Tool descriptions forbid stuffing “already over budget” into `proposed_action` so the verifier can find real mismatches.
