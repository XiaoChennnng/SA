# SA

SA（Science Agent）是一个面向科研工作的终端智能体。它直接读写工作区文件、执行命令，覆盖文献检索、论文阅读、数据分析、实验记录和论文写作。

本项目基于 [Pi](https://github.com/earendil-works/pi) 改进，是一个本地优先的 fork。项目名称为 **SA**，CLI 命令为 `sa`，配置位于 `~/.sa/agent`。

## 相对 Pi 的改进

### 1. 内置科研工具链

SA 默认启用一整套科研工具：

- `paper_search`：检索 arXiv、OpenAlex、Semantic Scholar、Crossref、PubMed、Europe PMC、OpenAIRE、DOAJ、HAL，并支持万方（Wanfang）、CNKI、NSTL 等中文来源
- `paper_read`：按 DOI、arXiv ID、PMID、URL 或本地文件读取论文，支持开放获取 PDF、页码范围、文本缓存和系统 PDF 提取器
- `citation`：按 DOI/arXiv/PMID 导入 BibTeX，支持列出、删除、校验和导出 `.bib`
- `latex_build`：调用 `latexmk`、`pdflatex`、`xelatex` 或 `lualatex` 编译 LaTeX 并报告诊断
- `python_run`：运行 Python 代码或脚本，捕获输出，可直接记录实验
- `paper_write`：把 Markdown 稿件排版为 PDF；没有 LaTeX 时可用 Python/reportlab
- `research_files`：在研究工作区内管理论文、笔记、数据、图表和稿件
- `web_search`、`web_extract`、`web_search_domains`：通过 AnySearch 搜索网页、读取完整页面
- `ask_user`：在需求不明确时用选项或自由文本向用户提问

### 2. 用 Markdown 维护研究知识库

论文、笔记和实验记录不再依赖 SQLite，而是追加到工作区内的 `research.md`：

- 纯 Markdown、可读、可 diff、可手改
- 只读操作不会创建数据库文件
- `research_note`、`experiment_log`、`citation` 以普通 `##` 小节追加内容，并按文本搜索
- 研究知识库、论文缓存和临时文件都跟随当前工作区

### 3. 工作区记忆

内置 `memory` 扩展让 SA 能自主维护两个工作区文件：

- `AGENTS.md`：项目约定、构建/测试命令、目录结构和约束
- `MEMORY.md`：项目偏好和反复出现的决策（例如回复风格、工具选择、提交习惯）

`MEMORY.md` 在每次运行前自动注入，`AGENTS.md` 的创建和修改在下一轮即可生效，本地和 SSH 工作区都支持。SA 只会为值得长期保留的信息创建或更新这两个文件，并禁止写入密钥或临时任务状态。

### 4. SSH 远程工作区

`/ssh user@host:/path` 可以把当前会话的文件、Shell、Python、LaTeX、论文写作和研究文件工具切换到远端 Linux/macOS 主机：

- 支持 SSH key、ssh-agent 和密码认证
- 密码认证使用进程内 SSH 客户端，并用 OpenSSH 做主机密钥预检和指纹固定
- 密码不落盘，只在当前进程内存中保留
- 研究文件在远端，研究知识库、论文缓存和临时目录仍留在本机，并按远端工作区隔离

### 5. 中文文献与本地配置

- 万方通过官方开放平台 APP_KEY 接入
- CNKI、NSTL 通过用户自行配置的授权命令接入
- `/research` 可交互式配置 API、中文来源和存储路径，修改立即生效
- `/doctor` 检查本地或远端工作区缺少的工具并给出安装建议

### 6. 去掉上游在线服务

这个 fork 不包含 Pi 的上游在线服务：

- 不检查更新
- 不上报 telemetry
- 不使用 Radius 网关
- 不提供会话分享
- 不依赖托管模型目录
- 不包含上游服务链接或归属信息

SA 仍然保留 Pi 的扩展、技能、提示模板、主题、包管理、RPC 和 TypeScript SDK 能力。

## 快速开始

需要 Node.js 22.19 或更高版本。

```bash
npm install --ignore-scripts
npm run build
```

从源码运行：

```bash
./sa-test.sh              # macOS/Linux
sa-test.bat               # Windows
```

或把 `sa` 命令链接到全局 npm 前缀：

```bash
npm link ./packages/coding-agent --ignore-scripts
sa
```

在要工作的目录中启动 SA，运行 `/login` 连接模型服务，然后直接提出任务。配置保存在 `~/.sa/agent`。

## 研究工具与工作区

研究工具默认启用。可以通过 `/research` 配置 API 和中文来源，通过 `/doctor` 检查依赖，通过 `/ssh` 切换远端工作区。

研究文件的默认布局如下（本地工作区）：

```text
<workspace>/research/
├── workspace/          # 论文、笔记、数据、图表、稿件
├── knowledge/research.md
├── cache/              # 下载的 PDF 和提取文本
└── work/               # 临时脚本和构建产物
```

SSH 工作区下，`workspace/` 在远端；知识库、缓存和临时目录留在本机的
`<local-workspace>/research/remote/<workspace-hash>/`。

更多说明见 [Research Workflow](packages/coding-agent/docs/research.md) 和
[SSH remote workspace](packages/coding-agent/docs/remote-workspace.md)。

## 包结构

| 包 | 说明 |
|---|---|
| **[@sa/coding-agent](packages/coding-agent)** | 交互式科研智能体 CLI、会话、工具、扩展和研究栈 |
| **[@sa/agent-core](packages/agent)** | 模型循环、Agent 状态、工具执行和传输抽象 |
| **[@sa/ai](packages/ai)** | 多 provider 模型层、认证和模型目录 |
| **[@sa/tui](packages/tui)** | 终端组件和差分渲染器 |
| **[@sa/codemode](packages/codemode)** | 注入工具的沙箱 JavaScript 执行 |
| **[@sa/mcp](packages/mcp)** | 独立 MCP 客户端 |
| **[@sa/durable](packages/durable)** | 持久化会话、任务和文档运行时 |
| **[@sa/env](packages/env)** | durable 运行时的远程执行守护进程 |
| **[@sa/telemetry](packages/telemetry)** | 厂商中立的 telemetry 契约和参考适配器 |
| **[@sa/chord](packages/chord)** | 可热重载插件的类型化宿主运行时 |

## 权限与隔离

SA 不提供内置的文件系统、进程、网络或凭据访问权限系统。默认情况下，它以启动它的用户和进程权限运行。如果需要更强的边界，请把 SA 放入容器或沙箱。参见
[containerization.md](packages/coding-agent/docs/containerization.md)。

## 开发

```bash
npm install --ignore-scripts  # 安装依赖，不执行生命周期脚本
npm run build:offline         # 离线构建全部包
npm run check                 # 格式、lint、类型和入口检查
./test.sh                     # 运行非 e2e 测试
./sa-test.sh                  # 从源码运行 SA
```

开发规则见 [AGENTS.md](AGENTS.md)。

## 许可证

MIT。SA 基于 Pi，Copyright (c) Mario Zechner and contributors。
