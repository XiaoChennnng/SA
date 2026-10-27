# Quickstart

SA runs in your terminal and works with files on your machine. To use it, you need access to a model through a supported provider. This can be a subscription, an API key, or a local model.

For native Windows setup, read [Windows Setup](windows.md). For Android, read [Termux Setup](termux.md).

## 1. Install SA

SA is installed from a source checkout. This requires Node.js 22.19 or newer:

```bash
npm install --ignore-scripts
npm run build
```

Run SA from the checkout with `./sa-test.sh`, or link the command into your global npm prefix:

```bash
npm link ./packages/coding-agent --ignore-scripts
```

SA does not require dependency lifecycle scripts for a normal installation.

With Nix on macOS or Linux, build and run the checkout directly:

```bash
nix run .
```

Verify the installation:

```bash
sa --version
```

## 2. Start SA

Change to the folder you want SA to work with, then start it:

```bash
cd /path/to/folder
sa
```

The working folder helps SA discover relevant files, instructions, and configuration. SA also uses it to group saved sessions.

<p align="center"><img src="images/interactive-mode.png" alt="SA running in a terminal with a conversation, input editor, and status footer" width="750"></p>

The interface shows your conversation, an editor for prompts and commands, and a footer with the current folder, model, and session status. See [Use SA in the terminal](usage.md) to learn how to add files, run commands, direct ongoing work, and manage results.

## 3. Choose a model

A **model** generates SA's responses. A **provider** is the service or account SA uses to access that model.

In SA, run:

```text
/login
```

Choose a provider, then follow the prompts to use a subscription or store an API key. Run `/model` afterward if you want to select a different available model.

See [Choose a model and provider](models.md) for supported providers, environment-variable authentication, local models, and custom endpoints.

## 4. Give SA a task

SA shows each file read, search, command, and edit it performs. It does not ask before every tool call.

Enter a task that matches your work, for example:

```text
Summarize @meeting-notes.md and save the action items to action-items.md.
```

```text
Explain how this repository is structured and how to run its checks.
```

```text
Compare @previous.csv with @current.csv and summarize the important changes.
```

Type `@` in the editor to search for a file instead of entering its full path. When SA finishes, review its response and any changed files. Use version control or backups for important work. For untrusted or unattended work, use a container or another sandbox. See [Security](security.md).

## Continue later

SA saves sessions automatically. Exit SA, then resume the most recent session for the same working folder with:

```bash
sa --continue
```

Use `/resume` to choose another saved session. See [Continue or branch a session](sessions.md) for session naming, branching, compaction, export, and sharing.

## Next steps

- [Use SA interactively](usage.md) to learn input, commands, shortcuts, and queued messages.
- [Add instructions](configuration.md#context-files) that SA should follow whenever it works in a folder.
- [Choose a model and provider](models.md).

### Choose how to customize SA

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Give SA persistent instructions for a folder | [`AGENTS.md` and `MEMORY.md`](configuration.md#memory-files) |
| Reuse a prompt from the `/` menu | [Prompt template](prompt-templates.md) |
| Add task-specific instructions and supporting files | [Skill](skills.md) |
| Add executable tools, commands, or event handlers | [Extension](extensions.md) |
| Build a custom terminal component | [Terminal UI](tui.md) |
| Connect an unsupported model service | [Custom provider](custom-provider.md) |
| Install or distribute several resources | [SA package](packages.md) |

## Uninstall SA

If you linked SA with npm, remove the link with:

```bash
npm unlink -g @sa/coding-agent
```

If you run SA from a checkout with `nix run .`, there is nothing to uninstall.

None of these methods removes configuration, credentials, sessions, or installed SA packages from `~/.sa/agent/`.
