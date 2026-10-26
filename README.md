# SA

SA (Science Agent) is an agent built for scientific research. It runs in your terminal, works
directly with your files and tools, and is designed for literature work, data analysis,
experiment tracking, and manuscript preparation.

This repository is a local fork of Pi, stripped of every upstream online service: no update checks,
no telemetry, no Radius gateway, no session sharing, and no hosted model catalog.

SA is designed to be adapted: extend it with [extensions](packages/coding-agent/docs/extensions.md),
[skills](packages/coding-agent/docs/skills.md), [prompt templates](packages/coding-agent/docs/prompt-templates.md),
and [themes](packages/coding-agent/docs/themes.md). Bundle them as [SA packages](packages/coding-agent/docs/packages.md).

Use SA [interactively](packages/coding-agent/docs/usage.md), automate it in
[print or JSON mode](packages/coding-agent/docs/cli.md), control it over [RPC](packages/coding-agent/docs/rpc.md),
or build apps with the [SA TypeScript SDK](packages/coding-agent/docs/sdk.md).

## Getting started

SA requires Node.js 22.19 or newer.

```bash
npm install --ignore-scripts
npm run build
```

Run SA from the checkout:

```bash
./sa-test.sh              # macOS/Linux
sa-test.bat               # Windows
```

Or link the `sa` command into your global npm prefix:

```bash
npm link ./packages/coding-agent --ignore-scripts
sa
```

Configuration lives under `~/.sa/agent`. Start SA in the directory where you want it to work, run
`/login` to connect a provider, then give it a task.

## Research tools

SA ships with research tools enabled by default:

- `paper_search` across arXiv, OpenAlex, Semantic Scholar, Crossref, PubMed, Europe PMC, OpenAIRE, DOAJ, and HAL, plus Wanfang and configurable CNKI/NSTL commands
- `web_search` and `web_extract` through AnySearch for web results and full pages
- `paper_read` for open-access PDFs and abstracts, with page ranges and caching
- `research_note` and `experiment_log` backed by a local SQLite knowledge base
- `citation` for BibTeX import, validation, and export
- `latex_build`, `paper_write`, and `python_run` for manuscripts and data analysis
- `research_files` for organizing papers, notes, data, figures, and manuscripts in a research workspace
- `ask_user` for clarifying ambiguous requirements through follow-up questions

PDF text extraction uses `pdftotext`, `mutool`, or Python with PyMuPDF; LaTeX and Python use their
system installations. Configure APIs and Chinese sources with `/research`. Use `/doctor` to have SA
inspect the current workspace for missing dependencies and install them in the conversation. Use
`/ssh user@host:/path` to work in a remote Linux/macOS directory with the same tools, using a key,
ssh-agent, or a masked password prompt. Local caches, the knowledge base, and settings live under
`~/.sa/agent/research/`; files in a remote workspace stay on that server.
See [Research Workflow](packages/coding-agent/docs/research.md) and
[SSH remote workspace](packages/coding-agent/docs/remote-workspace.md) for usage and settings.

## Packages

| Package | Description |
|---------|-------------|
| **[@sa/chord](packages/chord)** | Typed host runtime for hot-reloadable plugins, contracts, replicated state, and RPC over JSON links |
| **[@sa/telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts and reference adapter |
| **[@sa/ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@sa/durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@sa/agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@sa/coding-agent](packages/coding-agent)** | Interactive agent CLI |
| **[@sa/tui](packages/tui)** | Terminal UI library with differential rendering |

## Permissions and containerization

SA does not include a built-in permission system for restricting filesystem, process, network, or
credential access. By default it runs with the permissions of the user and process that launched it.
If you need stronger boundaries, containerize or sandbox SA. See
[containerization.md](packages/coding-agent/docs/containerization.md) for patterns (Gondolin
micro-VM, plain Docker, OpenShell).

## Development

```bash
npm install --ignore-scripts  # Install dependencies without lifecycle scripts
npm run build                 # Build all packages
npm run check                 # Lint, format, and type check
./test.sh                     # Run tests (skips LLM-dependent tests without API keys)
./sa-test.sh                  # Run SA from sources
```

## License

MIT. SA is based on Pi, Copyright (c) Mario Zechner and contributors.
