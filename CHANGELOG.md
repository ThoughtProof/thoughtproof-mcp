# Changelog

## Unreleased

- verify_decision: raise default timeouts (DQL 60s, Sentinel 90s) for live p95 headroom.


All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `verify_decision` hero tool — routes internally to DQL (`POST /dql/verify`) or Sentinel (`POST /sentinel/verify` with `mode=action_authorization`). Soft fail-closed `execute` flag (`true` only on `ALLOW`). Not published to npm.

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
