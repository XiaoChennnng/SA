# Changelog

## [Unreleased]

## [0.1.1-1029] - 2026-10-28

### Changed

- System prompt and tool descriptions are more concise, reducing per-request prompt tokens by roughly 15% in the default configuration without changing tool behavior.

### Fixed

- Updated `undici` to 8.12.3 to address upstream security advisories in the HTTP client.
- `install.ps1` detects the Windows architecture from `PROCESSOR_ARCHITECTURE`, fixing the null `RuntimeInformation.OSArchitecture` error in Windows PowerShell 5.1 on Windows 11.

## [0.1.1] - 2026-10-27

### Added

- `/login` now offers **OpenAI (custom)** and **Anthropic (custom)**. Each asks for a base URL and API key so the official protocol can run through a proxy or gateway. The base URL is stored with the credential, and `/logout` removes both.

## [0.1.0] - 2026-10-27

Initial SA (Science Agent) release, based on Pi.

### Added

- Rebranded the project as SA (Science Agent), with the `sa` CLI and configuration under `~/.sa/agent`.
- Built-in research tools: `paper_search` (arXiv, OpenAlex, Semantic Scholar, Crossref, PubMed, Europe PMC, OpenAIRE, DOAJ, HAL, Wanfang, CNKI/NSTL), `paper_read`, `citation`, `latex_build`, `python_run`, `paper_write`, `research_files`, `web_search`, `web_extract`, `web_search_domains`, and `ask_user`.
- Markdown research knowledge base (`research.md`) for papers, notes, experiments, and citations, with workspace-derived storage.
- Workspace memory extension: SA can maintain `AGENTS.md` (project conventions) and `MEMORY.md` (project preferences); `MEMORY.md` is injected before each run in local and SSH workspaces.
- SSH remote workspaces (`/ssh`) with key, ssh-agent, and password authentication; research storage stays local.
- `/research` configuration and `/doctor` environment checks.

### Changed

- Research storage follows the active workspace. In SSH workspaces research files stay remote, while the knowledge base, cache, and work directory stay local.
- Replaced the SQLite research store with plain Markdown.
- Removed upstream online services: no update checks, telemetry, Radius gateway, session sharing, or hosted model catalog.

### Removed

- Pi branding, upstream changelog history, and upstream-only CI workflows and links.
