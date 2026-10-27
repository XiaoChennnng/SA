# SSH remote workspace

`/ssh` runs the workspace tools on a remote Linux or macOS host while SA itself keeps running on
your machine. This is useful for GPU servers, compute clusters, and lab machines that hold the data
or software you need.

## Connect

```text
/ssh alice@gpu-lab:/data/project
```

The target can be a host, a `~/.ssh/config` alias, `user@host:/path`, or `host:port:/path`. Without a
path, the remote home directory is used. `/ssh` without arguments opens a menu; the wizard also asks
for an optional identity file and a remote research-files directory.

SA supports **key/ssh-agent** and **password** authentication. Key authentication uses your system
`ssh` and `~/.ssh/config`. Password authentication asks for the password with a masked prompt and
uses SA's in-process SSH client; the password is kept in session memory only and is never written to
settings. `/ssh password user@host:/path` starts a password connection directly.

The host key is always checked against your normal `known_hosts` before connecting. If the host is
not known yet, run `ssh host` once in a terminal and accept the key, then retry `/ssh`. Password
authentication requires a direct host; `ProxyJump` and `ProxyCommand` profiles should use key
authentication instead.

Once connected:

- `read`, `write`, `edit`, `grep`, `find`, `ls`, and `bash` operate on the remote host.
- `python_run`, `latex_build`, `paper_write`, `citation` file access, and `research_files` also run
  or write on the remote host.
- Relative paths resolve inside the remote workspace, using POSIX paths. Absolute paths are remote
  paths; local Windows paths do not apply.
- Literature and web search, the Markdown knowledge base, and paper caches stay on the local SA
  host. Their paths are derived from the local workspace and isolated per remote workspace under
  `<local-workspace>/research/remote/<workspace-hash>/`.

## Commands

| Command | Description |
|---|---|
| `/ssh` | Open the SSH workspace menu (key/agent or password) |
| `/ssh user@host:/path` | Connect using a key or ssh-agent |
| `/ssh password user@host:/path` | Connect with a password prompt |
| `/ssh use <profile>` | Connect a saved profile |
| `/ssh save <name>` | Save the active target as a named profile |
| `/ssh profiles` | List saved profiles |
| `/ssh delete <name>` | Delete a saved profile |
| `/ssh test` | Re-test the active connection and show remote tools |
| `/ssh status` | Show the active workspace |
| `/ssh disconnect` | Return to the local workspace |

Profiles are stored in the global settings file. A profile can record `auth: "password"`, but the
password itself is never stored: SA prompts again on the next connection and keeps it in session
memory only. Only the connection that you activate is session-scoped; SA does not reconnect
automatically on startup.

## Research files on the remote host

The remote research directory defaults to `<workspace>/research/workspace` and can be changed in the
wizard or a profile. `research_files` is confined to this directory. `paper_write` writes its
Markdown source and PDF under it, unless you provide an absolute output path. The local Markdown
knowledge base and paper cache for this connection follow the local workspace under
`<local-workspace>/research/remote/<workspace-hash>/`.

The remote host needs its own dependencies. Run `/doctor` after connecting; SA checks the active
workspace and reports missing tools. `/doctor` asks SA to run real commands in the current
workspace, so in SSH mode the checks run on the server. Follow the report and ask SA to install
missing dependencies in the conversation. Typical requirements:

- `bash` or `sh`, plus basic POSIX tools (`cat`, `mkdir`, `rm`, `mv`, `cp`, `find`, `grep`)
- Python 3 for `python_run`; `reportlab` for remote `paper_write`; `pypdf` optional
- `latexmk`, `pdflatex`, `xelatex`, or `lualatex` for `latex_build`
- CJK fonts for Chinese PDF typesetting (for example `fonts-noto-cjk`)
- `rg` and `fd` are optional; SA falls back to `git ls-files`, `find`, and `grep`

## Workspace memory

The built-in memory extension reads `MEMORY.md` and the first matching `AGENTS.override.md`,
`AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` from the remote workspace root before each
run. Only that root is scanned; remote parent directories are not. Local context files still load
from the local machine, so a remote `AGENTS.md` is added to the project context alongside them.

## Security and limits

- Only Linux and macOS remote hosts are supported. Remote Windows hosts are rejected.
- Key authentication uses OpenSSH semantics, including your normal SSH config and jump hosts.
  Password authentication uses a direct connection; ProxyJump/ProxyCommand profiles are rejected.
- Password authentication pins the host-key fingerprint observed by OpenSSH before the in-process
  client connects. Password prompts are masked, passwords never appear in command lines or settings,
  and they stay in memory for the current SA process only.
- Agent forwarding, X11 forwarding, local commands, and local port forwarding are disabled.
- Commands run with your SSH account's permissions. SA has no remote sandbox; use an unprivileged
  account or container on the server when needed.
- Key-authenticated workspaces open one SSH connection per operation; Windows OpenSSH does not
  support connection multiplexing. Password-authenticated workspaces reuse one in-process
  connection, which is faster.
- Aborting or timing out kills the local `ssh` client. The remote process may continue, so use
  `timeout`, `tmux`, or a job scheduler for long jobs.
- Extension tools that replace built-in tools, `@file` completion, and project resource discovery
  still use the local session directory.
