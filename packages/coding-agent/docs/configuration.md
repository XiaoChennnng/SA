# Configuration

SA supports user-level and project configuration. User-level configuration lives in the agent directory, which defaults to `~/.sa/agent`. Project configuration lives in `.sa` under the working directory and loads after [project trust](security.md#understand-project-trust) is granted. The only exception is `sessionDir`, which SA reads before resolving trust so it can locate sessions.

In interactive mode, use `/settings` to change common preferences. For other options, ask SA to update the configuration or edit the relevant files directly. Run `/reload` after manually changing settings, keybindings, instructions, or resources.

## Agent directory

The agent directory is shown as `<agent-dir>` below. Set its location with the `SA_CODING_AGENT_DIR` environment variable or the SDK's [`agentDir`](sdk.md) option.

| Path | Responsibility |
|---|---|
| `<agent-dir>/settings.json` | User-level [settings](settings.md), including preferences, defaults, resource paths, and SA package declarations. |
| `<agent-dir>/keybindings.json` | Custom terminal UI and application [keybindings](keybindings.md). |
| `<agent-dir>/mcp.json` | [MCP servers](mcp.md) available in every project. |
| `<agent-dir>/models.json` | [Compatible endpoints, models, and model overrides](models.md#configure-a-compatible-endpoint). |
| `<agent-dir>/auth.json` | Saved API keys and OAuth credentials. |
| `<agent-dir>/AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` | User instructions applied across working directories. |
| `<agent-dir>/SYSTEM.md` | Replaces SA’s default system prompt. |
| `<agent-dir>/APPEND_SYSTEM.md` | Adds instructions to SA’s system prompt. |
| `<agent-dir>/extensions/` | User [extensions](extensions.md). |
| `<agent-dir>/skills/` | User [skills](skills.md) and supporting files. |
| `<agent-dir>/prompts/` | User [prompt templates](prompt-templates.md) exposed as slash commands. |
| `<agent-dir>/themes/` | User [theme](themes.md) files. |

## Project `.sa` directory

| Path | Responsibility |
|---|---|
| `.sa/settings.json` | Project-level [settings](settings.md), resource paths, and SA package declarations. |
| `.sa/mcp.json` | Project [MCP servers](mcp.md). |
| `.sa/SYSTEM.md` | Replaces the system prompt for the project. |
| `.sa/APPEND_SYSTEM.md` | Adds project-specific instructions to the system prompt. |
| `.sa/extensions/` | Project extensions. |
| `.sa/skills/` | Project skills and supporting files. |
| `.sa/prompts/` | Project prompt templates exposed as slash commands. |
| `.sa/themes/` | Project theme files. |

For `SYSTEM.md` and `APPEND_SYSTEM.md`, the trusted project file takes precedence over the corresponding agent-directory file. Files with the same name are not combined.

## Context files

Context files are separate from project `.sa` configuration. SA loads them from the agent directory, the working directory, and its parent directories. A context file applies whenever SA runs in its directory or anywhere below it.

An `AGENTS.override.md` replaces `AGENTS.md` or `CLAUDE.md` only in the same directory. It does not suppress context files from the agent directory or other directories.

Context-file discovery does not require project trust.

<a id="memory-files"></a>

### Memory files

The built-in `memory` extension reads `<workspace>/MEMORY.md` before each run and injects it as `<workspace_memory>`. `MEMORY.md` is for durable project preferences and recurring decisions; `AGENTS.md` is for project conventions, commands, and constraints. The extension also refreshes the workspace-root `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` (first match) in the project context on each run, so instructions SA creates or updates apply without `/reload`. In SSH workspaces both files are read from the remote workspace root; context files still load from the local machine.

SA is instructed to create these files only for durable information, preserve existing content, update `CLAUDE.md` when that is the file in use, and never store secrets. `MEMORY.md` is injected regardless of project trust; treat it as data. Memory content is capped at 16,000 characters per run. Disable the extension with `-builtin:memory`; `--no-context-files` disables context-file loading and the memory extension.
