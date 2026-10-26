import { dirname } from "node:path";
import { getAgentDir } from "../../config.ts";
import { inspectPdfCommand, pdfCommandHint, resetPdfCommandDetection } from "../../research/pdf.ts";
import { LATEX_ENGINES, type PythonCommand, pythonCandidates, pythonCommandHint } from "../../research/runtime.ts";
import type { ResearchSettings } from "../../research/types.ts";
import { createLocalDoctorEnvironment } from "./local-env.ts";
import type { DoctorEnvironment, DoctorGroup, DoctorItem, DoctorReport, DoctorStatus } from "./types.ts";

export interface DoctorCheckOptions {
	env: DoctorEnvironment;
	settings: ResearchSettings;
	/** npm command from settings (argv form). */
	npmCommand?: string[];
	includeNetwork?: boolean;
}

const NODE_MIN_MAJOR = 22;
const NODE_MIN_MINOR = 19;

function isWindows(env: DoctorEnvironment): boolean {
	return env.platform === "win32" || env.platform === "windows";
}

function isMac(env: DoctorEnvironment): boolean {
	return env.platform === "darwin" || env.platform === "macos";
}

function packageInstall(env: DoctorEnvironment, name: string): string {
	if (name === "git") {
		if (isWindows(env)) return "winget install Git.Git";
		if (isMac(env)) return "brew install git";
		return "sudo apt install git (or dnf/pacman equivalent)";
	}
	if (name === "node") {
		if (isWindows(env)) return "winget install OpenJS.NodeJS.LTS";
		if (isMac(env)) return "brew install node";
		return "Install Node.js 22.19+ from nodejs.org or your package manager";
	}
	if (name === "python") {
		if (isWindows(env)) return "winget install Python.Python.3.12";
		if (isMac(env)) return "brew install python";
		return "sudo apt install python3 python3-pip (or dnf/pacman equivalent)";
	}
	if (name === "ssh") {
		if (isWindows(env)) return "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0";
		if (isMac(env)) return "ssh is built in on macOS";
		return "sudo apt install openssh-client (or dnf/pacman equivalent)";
	}
	if (name === "latex") {
		if (isWindows(env)) return "winget install MiKTeX.MiKTeX (or install TeX Live)";
		if (isMac(env)) return "brew install --cask mactex-no-gui";
		return "sudo apt install texlive-latex-recommended latexmk (or TeX Live equivalent)";
	}
	if (name === "pdftotext") {
		if (isWindows(env)) return "Install poppler for Windows, or run: python -m pip install PyMuPDF";
		if (isMac(env)) return "brew install poppler, or run: python -m pip install PyMuPDF";
		return "sudo apt install poppler-utils, or run: python -m pip install PyMuPDF";
	}
	return "";
}

function item(
	status: DoctorStatus,
	id: string,
	label: string,
	options: { detail?: string; required?: boolean; affects?: string[]; install?: string } = {},
): DoctorItem {
	return { id, label, status, ...options };
}

function parseNodeVersion(version: string): { major: number; minor: number } | undefined {
	const match = /^v?(\d+)\.(\d+)/.exec(version.trim());
	if (!match) return undefined;
	return { major: Number.parseInt(match[1]!, 10), minor: Number.parseInt(match[2]!, 10) };
}

async function probePython(
	env: DoctorEnvironment,
	configured: string | undefined,
): Promise<{ command?: PythonCommand; version?: string; error?: string }> {
	for (const candidate of pythonCandidates(configured)) {
		const probe = await env.probe(candidate.command, [...candidate.prefixArgs, "--version"]);
		if (probe.ok) {
			return { command: candidate, version: (probe.stdout.trim() || probe.stderr.trim()).trim() };
		}
	}
	if (configured) return { error: `Configured Python is not available: ${configured}` };
	return { error: pythonCommandHint() };
}

async function probeLatex(
	env: DoctorEnvironment,
	configured: string | undefined,
): Promise<{ engine?: string; error?: string }> {
	const candidates = configured ? [configured] : [...LATEX_ENGINES];
	for (const engine of candidates) {
		const probe = await env.probe(engine, ["--version"]);
		if (probe.ok) return { engine };
	}
	return {
		error: configured ? `Configured LaTeX command is not available: ${configured}` : "No LaTeX engine is available.",
	};
}

async function runtimeGroup(env: DoctorEnvironment, npmCommand?: string[]): Promise<DoctorGroup> {
	const items: DoctorItem[] = [];
	if (env.nodeVersion) {
		const parsed = parseNodeVersion(env.nodeVersion);
		const ok =
			parsed !== undefined &&
			(parsed.major > NODE_MIN_MAJOR || (parsed.major === NODE_MIN_MAJOR && parsed.minor >= NODE_MIN_MINOR));
		items.push(
			item(ok ? "ok" : "missing", "node", "Node.js", {
				detail: `${env.nodeVersion} (requires >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR})`,
				required: true,
				affects: ["all tools"],
				install: ok ? undefined : packageInstall(env, "node"),
			}),
		);
	}
	const npm = npmCommand?.length ? npmCommand : ["npm"];
	const npmProbe = await env.probe(npm[0]!, [...npm.slice(1), "--version"]);
	items.push(
		item(npmProbe.ok ? "ok" : "missing", "npm", "npm", {
			detail: npmProbe.ok ? npmProbe.stdout.trim() || "available" : "not found",
			required: false,
			affects: ["package installation"],
			install: npmProbe.ok ? undefined : "Install Node.js/npm for your platform",
		}),
	);
	const gitProbe = await env.probe("git", ["--version"]);
	items.push(
		item(gitProbe.ok ? "ok" : "warn", "git", "git", {
			detail: gitProbe.ok ? gitProbe.stdout.trim() : "not found (optional)",
			required: false,
			affects: ["git packages", "version control"],
			install: gitProbe.ok ? undefined : packageInstall(env, "git"),
		}),
	);
	const bashProbe = await env.probe("bash", ["--version"]);
	items.push(
		item(bashProbe.ok ? "ok" : "missing", "bash", "bash", {
			detail: bashProbe.ok ? "available" : isWindows(env) ? "Git Bash is required on Windows" : "not found",
			required: true,
			affects: ["bash"],
			install: bashProbe.ok ? undefined : isWindows(env) ? "winget install Git.Git" : "Install bash",
		}),
	);
	return { title: "Runtime", items };
}

async function searchGroup(env: DoctorEnvironment): Promise<DoctorGroup> {
	const items: DoctorItem[] = [];
	for (const [id, label, affects] of [
		["rg", "ripgrep (rg)", ["grep"]],
		["fd", "fd", ["find"]],
	] as const) {
		const located = await env.which(id);
		const probe = located
			? await env.probe(located, ["--version"])
			: { ok: false, status: null, stdout: "", stderr: "" };
		items.push(
			item(probe.ok ? "ok" : "warn", id, label, {
				detail: probe.ok
					? `${probe.stdout.split("\n")[0]?.trim() || "available"}${located ? ` (${located})` : ""}`
					: "not found; SA can download it on demand",
				required: false,
				affects: [...affects],
				install: probe.ok
					? undefined
					: "Let SA download it (ask in conversation: install rg/fd), or install it with your package manager",
			}),
		);
	}
	return { title: "Search tools (optional)", items };
}

async function researchGroup(env: DoctorEnvironment, settings: ResearchSettings): Promise<DoctorGroup> {
	const items: DoctorItem[] = [];
	const python = await probePython(env, settings.pythonPath);
	items.push(
		item(python.command ? "ok" : "missing", "python", "Python 3", {
			detail: python.command ? `${python.version || python.command.command}` : python.error,
			required: true,
			affects: ["python_run", "paper_write"],
			install: python.command ? undefined : packageInstall(env, "python"),
		}),
	);

	if (env.kind === "local") {
		resetPdfCommandDetection();
		const pdf = inspectPdfCommand(settings.pdfCommand);
		items.push(
			item(pdf.command ? "ok" : "missing", "pdf", "PDF text extractor", {
				detail: pdf.command ? `${pdf.command.kind}: ${pdf.command.command}` : pdf.error,
				required: true,
				affects: ["paper_read"],
				install: pdf.command ? undefined : `${pdfCommandHint()} ${packageInstall(env, "pdftotext")}`,
			}),
		);
	} else {
		const pdftotext = await env.probe("pdftotext", ["-v"], {
			acceptStatus: (status) => status === 0 || status === 99,
		});
		const mutool = pdftotext.ok ? undefined : await env.probe("mutool", ["-v"]);
		const pymupdf =
			pdftotext.ok || mutool?.ok
				? undefined
				: python.command
					? await env.probe(python.command.command, [...python.command.prefixArgs, "-c", "import fitz"])
					: undefined;
		const available = pdftotext.ok || mutool?.ok || pymupdf?.ok;
		items.push(
			item(available ? "ok" : "warn", "pdf", "PDF text extractor (remote)", {
				detail: pdftotext.ok ? "pdftotext" : mutool?.ok ? "mutool" : pymupdf?.ok ? "PyMuPDF" : "not found",
				required: false,
				affects: ["remote PDF workflows (optional; paper_read extracts locally)"],
				install: available
					? undefined
					: "Remote PDF extraction is optional; paper_read downloads remote files and extracts on the SA host",
			}),
		);
	}

	if (python.command) {
		for (const [module, label, affects, required] of [
			["reportlab", "Python reportlab", ["paper_write"], false],
			["pypdf", "Python pypdf (optional)", ["paper_write page count"], false],
			["fitz", "Python PyMuPDF", ["PDF extraction fallback"], false],
		] as const) {
			const probe = await env.probe(python.command.command, [
				...python.command.prefixArgs,
				"-c",
				`import ${module}`,
			]);
			items.push(
				item(probe.ok ? "ok" : required ? "missing" : "warn", `python-${module}`, label, {
					detail: probe.ok ? "installed" : "not installed",
					required,
					affects: [...affects],
					install: probe.ok
						? undefined
						: `Run: ${python.command.command} -m pip install ${module === "fitz" ? "PyMuPDF" : module}`,
				}),
			);
		}
	}

	const latex = await probeLatex(env, settings.latexCommand);
	items.push(
		item(latex.engine ? "ok" : "warn", "latex", "LaTeX engine", {
			detail: latex.engine ?? latex.error,
			required: false,
			affects: ["latex_build"],
			install: latex.engine ? undefined : packageInstall(env, "latex"),
		}),
	);

	if (env.kind === "ssh" && env.remotePaths) {
		const fcList = await env.probe("fc-list", [":lang=zh"]);
		const fontPaths = [
			"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
			"/System/Library/Fonts/PingFang.ttc",
		];
		let hasFonts = fcList.ok && fcList.stdout.trim().length > 0;
		if (!hasFonts) {
			for (const path of fontPaths) {
				if (await env.pathExists(path)) {
					hasFonts = true;
					break;
				}
			}
		}
		items.push(
			item(hasFonts ? "ok" : "warn", "cjk-fonts", "CJK fonts (remote paper_write)", {
				detail: hasFonts ? "found" : "no Chinese fonts detected",
				required: false,
				affects: ["paper_write"],
				install: hasFonts
					? undefined
					: isMac(env)
						? "macOS includes PingFang; otherwise install a CJK font"
						: "sudo apt install fonts-noto-cjk (or the equivalent for your distribution)",
			}),
		);
		const gpu = await env.probe("nvidia-smi", ["-L"]);
		if (gpu.ok) {
			items.push(
				item("info", "gpu", "GPU", {
					detail: gpu.stdout.trim().split(/\r?\n/).slice(0, 4).join("; "),
					required: false,
					affects: ["python_run", "bash"],
				}),
			);
		}
		const managers = ["apt-get", "dnf", "yum", "pacman", "apk", "brew"];
		for (const manager of managers) {
			if (await env.which(manager)) {
				items.push(
					item("info", "package-manager", "Package manager", {
						detail: manager,
						required: false,
						affects: ["dependency installation"],
					}),
				);
				break;
			}
		}
		const disk = await env.probe("df", ["-Pk", env.remotePaths.workspacePath]);
		if (disk.ok) {
			const line = disk.stdout.trim().split(/\r?\n/).at(-1)?.split(/\s+/);
			if (line && line.length >= 4) {
				items.push(
					item("info", "disk", "Remote workspace disk", {
						detail: `${line[3]} KB available`,
						required: false,
						affects: ["data processing"],
					}),
				);
			}
		}
	}
	return { title: "Research tools", items };
}

async function sshGroup(env: DoctorEnvironment): Promise<DoctorGroup> {
	const ssh = await env.probe("ssh", ["-V"]);
	const keygenPath = await env.which("ssh-keygen");
	const keygen = { ok: Boolean(keygenPath), stdout: keygenPath ?? "" };
	return {
		title: "SSH",
		items: [
			item(ssh.ok ? "ok" : "missing", "ssh", "ssh client", {
				detail: ssh.ok ? "available" : "not found",
				required: false,
				affects: ["/ssh remote workspace"],
				install: ssh.ok ? undefined : packageInstall(env, "ssh"),
			}),
			item(keygen.ok ? "ok" : "info", "ssh-keygen", "ssh-keygen (optional)", {
				detail: keygen.ok ? "available" : "not found; only needed to manage keys",
				required: false,
			}),
		],
	};
}

async function storageGroup(env: DoctorEnvironment, settings: ResearchSettings): Promise<DoctorGroup> {
	const checks: Array<[string, string, string]> =
		env.kind === "ssh" && env.remotePaths
			? [
					["remote-workspace", env.remotePaths.workspacePath, "remote workspace directory"],
					["remote-research", env.remotePaths.researchDir, "remote research files directory"],
				]
			: [
					["agent-dir", getAgentDir(), "SA agent directory"],
					["database", dirname(settings.databasePath), "research database directory"],
					["cache", settings.cacheDir, "paper cache directory"],
					["work", settings.workDir, "temporary work directory"],
					["workspace", settings.workspaceDir, "research workspace"],
				];
	const items: DoctorItem[] = [];
	for (const [id, path, label] of checks) {
		const exists = await env.pathExists(path);
		const writable = await env.pathWritable(path);
		items.push(
			item(writable ? "ok" : "missing", id, label, {
				detail: writable ? `${path}${exists ? "" : " (will be created)"}` : `${path} is not writable`,
				required: true,
				affects: ["research storage"],
				install: writable ? undefined : "Create the directory or fix its permissions",
			}),
		);
	}
	return { title: "Storage", items };
}

function configGroup(settings: ResearchSettings): DoctorGroup {
	const values: Array<[string, string, string | undefined]> = [
		["mailto", "OpenAlex/PubMed contact email", settings.mailto],
		["s2-key", "Semantic Scholar key", settings.semanticScholarApiKey],
		["ncbi-key", "NCBI key", settings.ncbiApiKey],
		["core-key", "CORE key", settings.coreApiKey],
		["anysearch-key", "AnySearch key", settings.anySearchApiKey],
		["wanfang-key", "Wanfang APP_KEY", settings.wanfangAppKey],
		["cnki-command", "CNKI command", settings.cnkiCommand],
		["nstl-command", "NSTL command", settings.nstlCommand],
	];
	return {
		title: "Configuration (optional)",
		items: values.map(([id, label, value]) =>
			item("info", id, label, {
				detail: value ? "configured" : "not set (optional)",
				required: false,
				affects: ["literature search"],
			}),
		),
	};
}

async function localAuxiliaryGroup(settings: ResearchSettings): Promise<DoctorGroup> {
	const env = createLocalDoctorEnvironment("SA host");
	resetPdfCommandDetection();
	const pdf = inspectPdfCommand(settings.pdfCommand);
	const items: DoctorItem[] = [
		item(pdf.command ? "ok" : "warn", "local-pdf", "Local PDF extractor (paper_read)", {
			detail: pdf.command ? `${pdf.command.kind}: ${pdf.command.command}` : pdf.error,
			required: false,
			affects: ["paper_read", "local PDF extraction"],
			install: pdf.command ? undefined : pdfCommandHint(),
		}),
	];
	for (const [id, path, label] of [
		["local-database", dirname(settings.databasePath), "Local research database directory"],
		["local-cache", settings.cacheDir, "Local paper cache directory"],
	] as const) {
		const writable = await env.pathWritable(path);
		items.push(
			item(writable ? "ok" : "warn", id, label, {
				detail: writable ? path : `${path} is not writable`,
				required: false,
				affects: ["research notes", "paper cache"],
				install: writable ? undefined : "Create the directory or fix its permissions",
			}),
		);
	}
	return { title: "Local auxiliary (SA host, optional)", items };
}

export async function collectDoctorReport(options: DoctorCheckOptions): Promise<DoctorReport> {
	const { env, settings } = options;
	const groups = [
		await runtimeGroup(env, options.npmCommand),
		await searchGroup(env),
		await researchGroup(env, settings),
		await sshGroup(env),
		await storageGroup(env, settings),
	];
	if (env.kind === "ssh") groups.push(await localAuxiliaryGroup(settings));
	groups.push(configGroup(settings));
	if (options.includeNetwork) groups.push(await checkNetworkGroup());
	const missing = groups.flatMap((group) => group.items).filter((entry) => entry.status === "missing");
	const warnings = groups.flatMap((group) => group.items).filter((entry) => entry.status === "warn");
	return {
		kind: env.kind,
		label: env.label,
		groups,
		missing,
		warnings,
		generatedAt: Date.now(),
	};
}

async function checkNetworkGroup(): Promise<DoctorGroup> {
	const urls: Array<[string, string]> = [
		["openalex", "https://api.openalex.org/works?per-page=1"],
		["crossref", "https://api.crossref.org/works?rows=0"],
		["anysearch", "https://api.anysearch.com/v1/sub-domains"],
	];
	const items: DoctorItem[] = [];
	for (const [id, url] of urls) {
		try {
			const response = await fetch(url, {
				method: "GET",
				headers: { "user-agent": "sa-doctor/0.1" },
				signal: AbortSignal.timeout(5000),
			});
			items.push(
				item(response.ok ? "ok" : "warn", `net-${id}`, id, {
					detail: `HTTP ${response.status}`,
					required: false,
					affects: ["literature search", "web search"],
				}),
			);
		} catch (error) {
			items.push(
				item("warn", `net-${id}`, id, {
					detail: error instanceof Error ? error.message : String(error),
					required: false,
					affects: ["literature search", "web search"],
					install: "Check network access/proxy settings (settings.json httpProxy or HTTPS_PROXY)",
				}),
			);
		}
	}
	return { title: "Network (SA host, optional)", items };
}
