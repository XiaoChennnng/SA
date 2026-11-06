# Changelog

## [Unreleased]

### Added

- Added the `openai-custom` and `anthropic-custom` providers. Both keep a user-supplied base URL, optional model IDs, and the API key in one stored credential.
- `openai-custom` speaks the OpenAI Chat Completions API so compatible proxies and gateways work; `anthropic-custom` speaks the Anthropic Messages API.
- Custom provider login now accepts a comma-separated model ID list. IDs found in the bundled catalog reuse their metadata; other names become models with conservative defaults, so endpoints are no longer limited to the vendors' official catalogs.
