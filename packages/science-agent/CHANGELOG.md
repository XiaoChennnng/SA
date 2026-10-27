# Changelog

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
