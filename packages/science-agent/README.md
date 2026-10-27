# SA

SA（Science Agent）是面向科研工作的终端智能体，基于 Pi 改进。完整介绍和安装说明见仓库根目录的 [README](../../README.md)。

本包是 SA 的主应用包 `@sa/science-agent`，提供 CLI、交互/打印/JSON/RPC 模式、会话运行时、工具、扩展和研究栈。

## 研究工具

默认启用：`paper_search`、`paper_read`、`research_note`、`experiment_log`、`citation`、`latex_build`、`python_run`、`paper_write`、`research_files`、`web_search`、`web_extract`、`web_search_domains` 和 `ask_user`。

研究知识库是工作区内的 `research.md`，由普通 Markdown 小节组成。工作区记忆由内置 `memory` 扩展维护：`AGENTS.md` 存项目约定，`MEMORY.md` 存项目偏好。

详见 [Research Workflow](docs/research.md)、[Context Files](docs/configuration.md#memory-files) 和 [SSH remote workspace](docs/remote-workspace.md)。

## 安装

不需要 Node.js，直接安装预编译二进制：

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.ps1 | iex
```

安装后运行 `sa`，首次使用 `/login` 连接模型服务。配置位于 `~/.sa/agent`。

## 从源码运行

需要 Node.js 22.19 或更高版本。在仓库根目录：

```bash
npm install --ignore-scripts
npm run build
./sa-test.sh              # macOS/Linux
sa-test.bat               # Windows
```

或链接 `sa` 命令：

```bash
npm link ./packages/science-agent --ignore-scripts
sa
```

## 开发

```bash
npm install --ignore-scripts
npm run check
./test.sh
```

实现、测试、依赖和发布规则见仓库根目录的 [AGENTS.md](../../AGENTS.md)。

## 许可

MIT。SA 基于 Pi，Copyright (c) Mario Zechner and contributors；SA 部分 Copyright (c) XiaoChennnng，详见 [LICENSE](../../LICENSE)。
