import { basename } from "node:path";
import { spawnProcessSync } from "../utils/child-process.ts";

// Shared external-command detection so tools and /doctor report the same environment.

export interface CommandProbe {
	ok: boolean;
	status: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}

export interface CommandProbeOptions {
	timeoutMs?: number;
	acceptStatus?: (status: number | null) => boolean;
}

export function probeCommandSync(command: string, args: string[], options: CommandProbeOptions = {}): CommandProbe {
	const result = spawnProcessSync(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		timeout: options.timeoutMs ?? 5000,
		encoding: "utf8",
	});
	const status = result.status ?? null;
	const ok = !result.error && (options.acceptStatus ? options.acceptStatus(status) : status === 0);
	return {
		ok,
		status,
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		...(result.error ? { error: result.error.message } : {}),
	};
}

export function commandIsAvailable(command: string, args: string[] = ["--version"]): boolean {
	return probeCommandSync(command, args).ok;
}

export interface PythonCommand {
	command: string;
	prefixArgs: string[];
}

// Only the Windows py launcher needs -3; python/python3 must not receive it.
export function pythonPrefixArgs(command: string): string[] {
	const name = basename(command).toLowerCase();
	return name === "py" || name === "py.exe" ? ["-3"] : [];
}

export function pythonCandidates(configured?: string): PythonCommand[] {
	if (configured) return [{ command: configured, prefixArgs: pythonPrefixArgs(configured) }];
	return [
		{ command: "python3", prefixArgs: [] },
		{ command: "python", prefixArgs: [] },
		{ command: "py", prefixArgs: ["-3"] },
	];
}

export interface PythonResolution {
	command?: PythonCommand;
	error?: string;
}

export function resolvePythonCommand(
	configured?: string,
	isAvailable: (command: string, args: string[]) => boolean = commandIsAvailable,
): PythonResolution {
	const candidates = pythonCandidates(configured);
	for (const candidate of candidates) {
		if (isAvailable(candidate.command, [...candidate.prefixArgs, "--version"])) {
			return { command: candidate };
		}
	}
	if (configured) return { error: `Configured Python is not available: ${configured}` };
	return { error: pythonCommandHint() };
}

export function pythonCommandHint(): string {
	return "No Python interpreter found. Install Python 3 or set research.pythonPath in settings.json.";
}

export function pythonVersion(command: PythonCommand): string | undefined {
	const probe = probeCommandSync(command.command, [...command.prefixArgs, "--version"]);
	const text = probe.stdout.trim() || probe.stderr.trim();
	return text || undefined;
}

export function pythonModuleAvailable(command: PythonCommand, module: string): boolean {
	return probeCommandSync(command.command, [...command.prefixArgs, "-c", `import ${module}`]).ok;
}

export function pythonInstallHint(module: string): string {
	const command = module === "pymupdf" || module === "fitz" ? "PyMuPDF" : module;
	return `Install it with \`python -m pip install ${command}\` (or the matching package for your Python).`;
}

export const LATEX_ENGINES = ["latexmk", "pdflatex", "xelatex", "lualatex"] as const;
export type LatexEngine = (typeof LATEX_ENGINES)[number];

export function isLatexEngine(command: string): command is LatexEngine {
	return (LATEX_ENGINES as readonly string[]).includes(command);
}

export interface LatexResolution {
	engine?: string;
	error?: string;
}

export function resolveLatexEngine(
	configured?: string,
	isAvailable: (command: string) => boolean = (command) => commandIsAvailable(command, ["--version"]),
): LatexResolution {
	if (configured) {
		if (isAvailable(configured)) return { engine: configured };
		return { error: `LaTeX command is not available: ${configured}` };
	}
	for (const engine of LATEX_ENGINES) {
		if (isAvailable(engine)) return { engine };
	}
	return { error: latexCommandHint() };
}

export function latexCommandHint(): string {
	return [
		"No LaTeX engine is available.",
		"Install TeX Live or MiKTeX (latexmk, pdflatex, xelatex, or lualatex),",
		"or set research.latexCommand in settings.json.",
	].join(" ");
}
