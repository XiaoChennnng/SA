# SA

SA (Science Agent) is an agent built for scientific research. It runs in your terminal, works
directly with your files and tools, and is designed for literature work, data analysis,
experiment tracking, and manuscript preparation. This repository is a local fork of Pi with all
upstream online services removed.

Customize SA with [extensions](docs/extensions.md), [skills](docs/skills.md),
[prompt templates](docs/prompt-templates.md), and [themes](docs/themes.md). Bundle them as
[SA packages](docs/packages.md).

Use SA [interactively](docs/usage.md), automate it in [print or JSON mode](docs/cli.md), control it
over [RPC](docs/rpc.md), or build apps with the [SA TypeScript SDK](docs/sdk.md).

## Research tools

Seven research tools are enabled by default: `paper_search`, `paper_read`, `research_note`,
`experiment_log`, `citation`, `latex_build`, and `python_run`. See [Research Workflow](docs/research.md)
for the literature and experiment loops, storage layout, and system requirements.

## Getting started

SA requires Node.js 22.19 or newer.

From a source checkout:

```bash
npm install --ignore-scripts
npm run build
./sa-test.sh
```

Or link the `sa` command into your global npm prefix:

```bash
npm link ./packages/coding-agent --ignore-scripts
```

Configuration lives under `~/.sa/agent`. Run `/login` inside SA to connect a provider, then give
SA a task.

## Development

```bash
npm install --ignore-scripts
npm run check
./test.sh
```

Read [AGENTS.md](../../AGENTS.md) for repository-specific implementation, testing, dependency, and
release rules.

## License

MIT. SA is based on Pi, Copyright (c) Mario Zechner and contributors.
