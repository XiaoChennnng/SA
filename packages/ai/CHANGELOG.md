# Changelog

## [Unreleased]

### Added

- Added the `openai-custom` and `anthropic-custom` providers. Both reuse their official model catalogs and keep a user-supplied base URL with the stored API key credential.
- `openai-custom` speaks the OpenAI Chat Completions API so compatible proxies and gateways work; `anthropic-custom` speaks the Anthropic Messages API.
