# SA

SA（Science Agent）是一个面向科研工作的终端智能体。它直接在你的工作区里读写文件、运行命令、检索文献，把文献调研、数据分析、实验记录和论文写作串成一条可复现的工作流。

- **文献**：多源检索、开放获取 PDF 阅读、BibTeX 导入/校验/导出，支持中文文献来源
- **数据**：运行 Python、记录实验配置与指标、对比多次运行
- **写作**：编译 LaTeX，或把 Markdown 稿件排版为 PDF
- **记忆**：在工作区内维护 `AGENTS.md` 和 `MEMORY.md`，跨会话保留项目约定与偏好
- **本地优先**：研究数据留在本机；不包含遥测、自动更新、会话分享等在线服务

SA 基于 [Pi](https://github.com/earendil-works/pi) 的开源架构，针对科研场景重新设计了工具链、存储和工作区模型。CLI 命令为 `sa`，配置位于 `~/.sa/agent`。

## 安装

不需要 Node.js。直接安装对应平台的预编译二进制：

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.ps1 | iex
```

安装脚本会自动识别系统和架构，从 [Releases](https://github.com/XiaoChennnng/SA/releases) 下载并校验 SHA256，安装到 `~/.local/bin`（Windows 为 `%LOCALAPPDATA%\SA`）。也可以手动下载 `sa-darwin-arm64.tar.gz`、`sa-linux-x64.tar.gz`、`sa-windows-x64.zip` 等资产。

安装完成后，在要工作的目录中运行：

```bash
sa
```

首次运行使用 `/login` 连接模型服务，然后直接提出任务。重新运行安装脚本即可升级。

可选环境变量：`SA_VERSION=v0.1.0` 指定版本；macOS/Linux 可用 `SA_BIN_DIR`、`SA_DATA_DIR` 指定安装位置，Windows 可用 `SA_INSTALL_DIR`。

## 从源码运行

需要 Node.js 22.19 或更高版本，适合开发和贡献：

```bash
npm install --ignore-scripts
npm run build
./sa-test.sh              # macOS/Linux
sa-test.bat               # Windows
```

或把 `sa` 命令链接到全局 npm 前缀：

```bash
npm link ./packages/science-agent --ignore-scripts
sa
```

## 核心工作流

### 文献调研

1. 用 `paper_search` 检索 arXiv、OpenAlex、Semantic Scholar、Crossref、PubMed、Europe PMC、OpenAIRE、DOAJ、HAL，以及配置好的万方、CNKI、NSTL 来源
2. 用 `paper_read` 按 DOI、arXiv ID、PMID、URL 或本地 PDF 阅读全文，支持页码范围
3. 用 `research_note` 把结论、引文和疑问写入研究知识库
4. 用 `citation` 导出 `references.bib`

### 实验与分析

1. 用 `bash` 或 `python_run` 运行分析，脚本和参数保留在工作区
2. 用 `experiment_log` 记录假设、配置、指标、产物和状态
3. 直接读取 `research.md` 中的实验小节，对比多次运行后写入论文

### 论文写作

- `latex_build` 调用 `latexmk`、`pdflatex`、`xelatex` 或 `lualatex`
- `paper_write` 把 Markdown 稿件排版为 PDF；没有 LaTeX 时使用 Python/reportlab

## 研究工具

| 工具 | 用途 |
|---|---|
| `paper_search` | 多源文献检索，返回 DOI、arXiv ID、PMID、摘要和开放获取 PDF 链接 |
| `paper_read` | 读取论文全文或摘要，支持页码范围、文本缓存和系统 PDF 提取器 |
| `research_note` | 追加和搜索研究笔记 |
| `experiment_log` | 追加和搜索实验记录 |
| `citation` | 导入、列出、删除、校验和导出 BibTeX |
| `latex_build` | 编译 LaTeX 并报告诊断 |
| `python_run` | 运行 Python 代码或脚本，捕获输出，可记录实验 |
| `paper_write` | 把 Markdown 稿件排版为 PDF |
| `research_files` | 在研究工作区内管理论文、笔记、数据、图表和稿件 |
| `web_search` / `web_extract` | 通过 AnySearch 搜索网页、读取完整页面 |
| `ask_user` | 需求不明确时用选项或自由文本提问 |

PDF 文本提取使用 `pdftotext`、`mutool` 或 Python/PyMuPDF；LaTeX 和 Python 使用系统安装。

## 工作区与研究存储

本地工作区的默认布局：

```text
<workspace>/research/
├── workspace/          # 论文、笔记、数据、图表、稿件
├── knowledge/research.md
├── cache/              # 下载的 PDF 和提取文本
└── work/               # 临时脚本和构建产物
```

`research.md` 是普通 Markdown 知识库，论文、笔记、实验和引用以小节形式保存，可直接阅读和编辑。SSH 工作区下 `workspace/` 在远端，知识库、缓存和临时目录留在本机并按远端工作区隔离。

## 工作区记忆

SA 可以自主维护工作区根目录的两个文件：

- `AGENTS.md`：项目约定、构建/测试命令、目录结构和约束
- `MEMORY.md`：项目偏好和反复出现的决策

`MEMORY.md` 在每次运行前自动注入，`AGENTS.md` 的创建和修改在下一轮即可生效，本地和 SSH 工作区都支持。SA 只为值得长期保留的信息创建或更新它们，并避免写入密钥或临时任务状态。详见 [Context Files](packages/science-agent/docs/configuration.md#memory-files)。

## 远程工作区

`/ssh user@host:/path` 把文件、Shell、Python、LaTeX、论文写作和研究文件工具切换到远端 Linux/macOS 主机。支持 SSH key、ssh-agent 和密码认证；密码只保留在当前进程内存中，主机密钥会预检并固定。研究知识库和缓存仍留在本机。

详见 [SSH remote workspace](packages/science-agent/docs/remote-workspace.md)。

## 配置与诊断

- `/research`：交互式配置文献 API、中文来源、存储路径和系统工具
- `/doctor`：检查当前工作区缺少的依赖并给出安装建议
- 全局设置：`~/.sa/agent/settings.json`
- 项目设置：`.sa/settings.json`

## 扩展与集成

- [Extensions](packages/science-agent/docs/extensions.md)、[Skills](packages/science-agent/docs/skills.md)、[Prompt Templates](packages/science-agent/docs/prompt-templates.md)、[Themes](packages/science-agent/docs/themes.md)
- 打包分发：[SA Packages](packages/science-agent/docs/packages.md)
- 编程接入：[TypeScript SDK](packages/science-agent/docs/sdk.md)、[RPC](packages/science-agent/docs/rpc.md)、[打印/JSON 模式](packages/science-agent/docs/cli.md)

## 包结构

| 包 | 说明 |
|---|---|
| **[@sa/science-agent](packages/science-agent)** | 主应用：CLI、会话、工具、扩展和研究栈 |
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

SA 不提供内置的文件系统、进程、网络或凭据访问权限系统。默认情况下，它以启动它的用户和进程权限运行。如果需要更强的边界，请把 SA 放入容器或沙箱。参见 [containerization.md](packages/science-agent/docs/containerization.md)。

## 开发

```bash
npm install --ignore-scripts  # 安装依赖，不执行生命周期脚本
npm run build:offline         # 离线构建全部包
npm run check                 # 格式、lint、类型和入口检查
./test.sh                     # 运行非 e2e 测试
./sa-test.sh                  # 从源码运行 SA
```

开发规则见 [AGENTS.md](AGENTS.md)；研究工具细节见 [Research Workflow](packages/science-agent/docs/research.md)。

## 许可

MIT。SA 基于 Pi，Copyright (c) Mario Zechner and contributors；SA 部分 Copyright (c) XiaoChennnng，详见 [LICENSE](LICENSE)。
